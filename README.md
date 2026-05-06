# Syslab Scraper & Microservicio de Integracion HHR

Microservicio local en Node.js, Express y Playwright para consultar examenes de laboratorio desde el portal interno Syslab del Hospital Hanga Roa (`http://10.4.69.90/syslab/`).

Este servicio existe porque Syslab no expone una API publica consumible por HHR. El scraper automatiza Chromium con Playwright, navega como usuario autenticado, extrae ordenes de laboratorio y captura PDFs para transformarlos en datos estructurados.

## Funcion principal

```text
HHR -> Syslab Scraper -> Portal Syslab -> JSON/PDF -> HHR
```

En local, HHR llama directamente a:

```text
http://localhost:3000
```

En Netlify, HHR llama a una Function serverless (`syslab-proxy`) que a su vez llama a una URL publica configurada como `SYSLAB_PROXY_URL`. Esa URL debe ser un tunel activo hacia este scraper local.

## Endpoints disponibles

### `GET /health`

Comprueba que el microservicio esta encendido.

```bash
curl "http://localhost:3000/health"
```

### `GET /api/exams?rut=<rut>`

Busca ordenes de laboratorio por RUT.

```bash
curl "http://localhost:3000/api/exams?rut=10096004"
```

Devuelve una lista de ordenes con:

- `id`
- `link`
- `date`
- `time`
- `patientName`
- `origin`
- `exams`

### `POST /api/exams/details`

Recibe links de ordenes y devuelve resultados estructurados extraidos desde PDFs.

```bash
curl -X POST "http://localhost:3000/api/exams/details" \
  -H "Content-Type: application/json" \
  -d '{"links":["http://10.4.69.90/syslab/detalleexamenes.php?id=..."]}'
```

### `GET /api/exams/pdf?link=<url>`

Devuelve el PDF de una orden para visualizacion inline.

```bash
curl "http://localhost:3000/api/exams/pdf?link=<url_codificada>"
```

## Variables de entorno

Crear o mantener `.env` en la raiz:

```bash
PORT=3000
SYSLAB_BASE_URL=http://10.4.69.90/syslab/
SYSLAB_USER=<usuario_syslab>
SYSLAB_PASS=<clave_syslab>
```

## Ejecucion local

```bash
cd "/Users/daniel/Documents/scraper LAB"
node server.js
```

El servicio queda disponible en:

```text
http://localhost:3000
```

## Uso con HHR local

HHR debe tener:

```bash
VITE_SYSLAB_API_URL=http://localhost:3000
VITE_SYSLAB_ENABLE_DIRECT_LOCAL=true
```

Levantar HHR en otro puerto, por ejemplo:

```bash
cd "/Users/daniel/Documents/HHR 2026 tracker version MacBookAir"
VITE_SYSLAB_ENABLE_DIRECT_LOCAL=true npm run dev -- --host 0.0.0.0 --port 3020
```

## Uso con HHR desplegado en Netlify

Netlify no puede acceder al `localhost` del Mac ni directamente a `10.4.69.90`. Para que Lab funcione en produccion:

1. Este scraper debe estar corriendo en el Mac local (`localhost:3000`).
2. El Mac debe tener acceso real a `http://10.4.69.90/syslab/`.
3. Debe existir un tunel publico hacia `localhost:3000`.
4. Netlify debe tener `SYSLAB_PROXY_URL` apuntando a ese tunel.

Ejemplo:

```bash
npm run tunnel:ngrok
```

Verificar:

```bash
curl "https://hyperkalemic-transthoracic-lecia.ngrok-free.dev/health"
```

Si el tunel esta offline, Netlify devolvera `503` en `/.netlify/functions/syslab-proxy?action=health` y el boton Lab aparecera deshabilitado.

## Diagnostico rapido

```bash
npm run check:syslab
curl "http://localhost:3000/health"
curl -I --max-time 5 "http://10.4.69.90/syslab/"
curl "https://<SYSLAB_PROXY_URL>/health"
```

Interpretacion:

- Falla `localhost:3000/health`: el scraper no esta corriendo.
- Falla `10.4.69.90/syslab`: no hay acceso real a Syslab.
- Falla `SYSLAB_PROXY_URL/health`: el tunel esta apagado, mal apuntado o caducado.

`npm run check:syslab` resume el estado del scraper local y del tunel publico en una sola salida. Tambien muestra el acceso directo a Syslab como advertencia orientativa, porque el flujo real usa Playwright y puede comportarse distinto a `curl`.

## Logs

- `logs/combined.log`: eventos generales.
- `logs/error.log`: fallos de navegacion, login o scraping.
- `logs/debug_post_aceptar_*.html`: HTML capturado despues de buscar RUT.
- `logs/raw_extract_*.txt`: texto crudo extraido desde PDFs.
- `logs/login_error_*.png`: capturas de error de login.

## Tests

```bash
npm test
```

## Documentacion tecnica

El documento detallado esta en:

```text
technical_data_access.md
technical_data_access_actualizado_2026-05-06.pdf
```
