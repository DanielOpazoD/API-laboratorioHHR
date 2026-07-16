# Documentacion tecnica de Syslab Scraper HHR

Actualizado: 2026-07-15

Este documento describe como funciona **Syslab Scraper**, el microservicio local que permite a HHR consultar examenes de laboratorio desde el portal interno Syslab (`http://10.4.69.90/syslab/`).

El punto clave operativo es que Syslab vive en una red privada del hospital. El scraper se ejecuta en
el mismo equipo que Chrome y sólo atiende por loopback a la extensión nativa de Rayen.

## Arquitectura actual

```text
Extensión Chrome en fichamedico.rayensalud.cl
  -> http://127.0.0.1:3001
  -> Syslab Scraper local
  -> http://10.4.69.90/syslab/
```

La extensión nativa de Rayen conversa con este servicio únicamente por loopback. El servicio no debe
publicarse mediante túneles: contiene una sesión autenticada contra el laboratorio interno.

## Componentes principales

- `server.js`: arranca Express, sirve `public/`, expone `/health` y monta las rutas `/api`.
- `config/env.js`: centraliza `PORT`, `SYSLAB_BASE_URL`, `SYSLAB_USER` y `SYSLAB_PASS`.
- `routes/api.js`: define los endpoints de laboratorio.
- `controllers/examController.js`: valida parametros HTTP y delega en el orquestador.
- `services/browserManager.js`: inicializa Chromium con Playwright y realiza login en Syslab.
- `services/scraperOrchestrator.js`: coordina busqueda de ordenes, descarga/captura de PDFs y extraccion de resultados.
- `services/examBatchStore.js`: mantiene por 15 minutos la relación opaca entre IDs de orden y URLs Syslab.
- `utils/reportParser.js`: transforma texto crudo de PDF en resultados estructurados.
- `logs/`: sólo recibe artefactos clínicos de diagnóstico cuando `SYSLAB_DEBUG_ARTIFACTS=true`.

## Variables de entorno

El scraper lee `.env` desde la raiz del proyecto.

```bash
PORT=3000
SYSLAB_BASE_URL=http://10.4.69.90/syslab/
SYSLAB_USER=<usuario_syslab>
SYSLAB_PASS=<clave_syslab>
SYSLAB_ALLOWED_EXTENSION_IDS=<id_extension_chrome>
SYSLAB_DEBUG_ARTIFACTS=false
```

Las credenciales y la lista de IDs autorizados no tienen valores por defecto: el proceso falla al
arrancar si faltan. Copia el ID que muestra `chrome://extensions` para la extensión cargada; se pueden
autorizar varios IDs separados por coma. Por defecto escucha sólo en `127.0.0.1`, rechaza orígenes web
y extensiones no autorizadas. Para diagnóstico admite clientes locales sin `Origin` ni encabezados
`Sec-Fetch-*`; las cargas web sin origen también se rechazan.

## Endpoints

### `GET /health`

Verifica que el microservicio Express esta encendido.

Respuesta esperada:

```json
{
  "status": "ok",
  "service": "syslab-scraper",
  "version": "1.0.0",
  "timestamp": "2026-05-06T20:12:22.022Z"
}
```

### `GET /api/exams?rut=<rut>`

Busca las ordenes de laboratorio asociadas a un RUT.

Flujo:

1. Recibe el RUT desde HHR.
2. Inicia Chromium headless con Playwright.
3. Abre `SYSLAB_BASE_URL`.
4. Realiza login con `SYSLAB_USER` y `SYSLAB_PASS`.
5. Navega a la busqueda por RUT.
6. Normaliza el RUT a cuerpo numerico, sin puntos, guion ni digito verificador.
7. Extrae filas de `table.narrow tr` y valida que el RUN informado por cada fila coincida con la
   consulta. Si alguna orden pertenece a otro RUN, la respuesta falla de forma completa.
8. Crea un lote opaco temporal y devuelve `batchId`, `rutBody` y metadatos de orden. Las URLs internas
   permanecen exclusivamente en memoria dentro del scraper.

Ejemplo:

```bash
curl "http://localhost:3000/api/exams?rut=10096004"
```

### `POST /api/exams/details`

Recibe el lote opaco y una lista de IDs de orden; resuelve las URLs exclusivamente en el servidor.

Entrada:

```json
{
  "batchId": "b4390860-81d2-45b0-bc5c-540fbcd7931c",
  "examIds": ["43092478"]
}
```

Flujo:

1. Abre una sesion autenticada en Syslab.
2. Comprueba que cada ID pertenezca al lote vigente y procesa sus URLs con concurrencia controlada.
3. Captura PDF mediante listeners de red, evento de descarga o links embebidos.
4. Si no encuentra PDF nativo, genera un PDF desde el HTML renderizado como ultimo fallback.
5. Extrae texto con `pdf-parse` y comprueba que `Rut/Fic` coincida con `rutBody`.
6. Si un informe no confirma el RUN, lo devuelve como error y el visor cancela el lote completo.
7. Parsea variables con `utils/reportParser.js`. Sólo guarda texto crudo si se habilitó explícitamente
   `SYSLAB_DEBUG_ARTIFACTS=true` para diagnóstico local controlado.

### `GET /api/exams/pdf?batchId=<uuid>&examId=<id>`

Devuelve el PDF de una orden para visualizacion inline en HHR.

El servicio comprueba que la orden pertenezca al lote, resuelve su URL internamente, reautentica contra
Syslab y captura el PDF por respuesta de red, descarga nativa o renderizado HTML como fallback. Antes de
entregar bytes vuelve a extraer `Rut/Fic` del documento y exige coincidencia con el RUN del lote.

## Flujo local de operacion

Terminal 1: levantar Syslab Scraper.

```bash
cd "/Users/daniel/Documents/scraper LAB"
PORT=3001 node server.js
```

Verificar:

```bash
curl "http://127.0.0.1:3001/health"
```

Terminal 2: levantar HHR local en un puerto distinto de `3000`.

```bash
cd "/Users/daniel/Documents/HHR 2026 tracker version MacBookAir"
VITE_SYSLAB_ENABLE_DIRECT_LOCAL=true npm run dev -- --host 0.0.0.0 --port 3020
```

HHR local queda en:

```text
http://localhost:3020/
```

## Diagnostico rapido

### Error `page.goto: net::ERR_ADDRESS_UNREACHABLE`

Playwright no puede abrir `http://10.4.69.90/syslab/`.

Checklist:

```bash
curl -I --max-time 5 "http://10.4.69.90/syslab/"
ping 10.4.69.90
```

Posibles causas:

- El Mac no esta en la red hospitalaria correcta.
- El servidor Syslab esta apagado o cambio de IP.
- Hay bloqueo de red, VLAN o firewall.
- El cable/adaptador/interfaz no tiene ruta valida.

## Logs utiles

- `logs/combined.log`: solicitudes y eventos generales.
- `logs/error.log`: fallos de login, navegacion y scraping.
- Con `SYSLAB_DEBUG_ARTIFACTS=true`, `logs/debug_post_aceptar_*.html`, `raw_extract_*.txt` y
  `login_error_*.png` ayudan a diagnosticar. Deben tratarse como datos clínicos temporales.

## Pruebas

```bash
npm test
```

Pruebas relevantes:

- `tests/scraperExamListExtraction.test.js`: valida extraccion de filas de examenes.
- `tests/scraperOrchestratorConcurrency.test.js`: valida helpers de concurrencia.
- `tests/examBatchStore.test.js`: valida expiracion, límites y ausencia de URLs en el contrato público.

## Limites y riesgos operativos

- El scraper depende del HTML real de Syslab; cambios de DOM pueden romper selectores.
- El portal Syslab no expone API publica, por lo que Playwright actua como un usuario automatizado.
- No se admite exposición pública ni túneles; el host por defecto es `127.0.0.1`.
- No conviene disparar consultas masivas desde el navegador clinico durante atencion; las consultas deben ser acotadas o programadas.

## Resumen ejecutivo

Syslab Scraper funciona como puente local entre la extensión nativa de Rayen y un sistema interno sin
API. Las URLs de informes permanecen en lotes opacos en memoria, las credenciales sólo vienen de `.env`
y el proceso escucha por defecto exclusivamente en `127.0.0.1`.
