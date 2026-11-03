# Puente de laboratorio Syslab para HHR

Servidor local Node.js/Express/Playwright. Se instala en el Mac mini que puede acceder a
Syslab y a Internet. HHR en Netlify autentica al profesional con Firebase y consulta este
servidor por un túnel HTTPS. No requiere Google Cloud ni abrir puertos en el router.

## Contrato con HHR actual

Todas las rutas exigen `Authorization: Bearer <SYSLAB_API_TOKEN>`. El servidor escucha por
defecto en `127.0.0.1:3100`. No expone la interfaz web anterior sin autenticación.

- `GET /health`: inicia sesión en Syslab; `connected:true` acredita esa sesión, no solo un proceso encendido.
- `GET /api/exams?rut=<cuerpo RUN>`: devuelve `{success,data}` con órdenes y referencias cifradas.
- `POST /api/exams/details`, JSON `{links:[...]}`: entre 1 y 3 informes de un mismo paciente.
- `GET /api/exams/pdf?link=<referencia>`: PDF original validado, máximo 4 MiB.

Las referencias `hhr-syslab-remote://report/...` vencen a los 30 minutos y contienen de
forma cifrada la ruta y el RUN consultado. No se aceptan URLs arbitrarias de informes.
Cada encabezado `Rut/Fic` del PDF debe coincidir con el paciente; un informe ausente,
fallido o de otro paciente nunca se convierte en un resultado vacío exitoso. Se conserva
el esquema `findings` del visor. Una búsqueda vieja debe repetirse después de actualizar.

HHR agrupa el análisis en lotes de tres y conserva sus controles de propietario,
cancelación, progreso e integridad. La extensión local sigue siendo la ruta predeterminada.
El modo remoto se activa expresamente con `VITE_SYSLAB_TRANSPORT=remote` en HHR.

## Instalación mañana en el Mac mini

Requisitos: Node.js 22 o posterior, Git y ngrok instalado/autenticado con tu cuenta.
Primero comprueba que el Mac abre Syslab en la LAN. Usa una carpeta estable (no temporal):

```sh
git clone https://github.com/DanielOpazoD/API-laboratorioHHR.git "$HOME/HHR-laboratorio"
cd "$HOME/HHR-laboratorio"
npm ci
npx playwright install chromium
npm run configure:mac
```

El configurador pide en la terminal usuario y contraseña de Syslab, la clave compartida
preparada en Netlify y el dominio HTTPS de tu túnel. Las claves no se muestran ni se
incluyen en argumentos de procesos. El configurador conserva los caracteres exactos mediante
valores BASE64 (codificación, no cifrado); guarda `.env` local con permisos 600. No lo subas a
GitHub ni pegues secretos en el chat. No existen credenciales predeterminadas: las que
aparecían en revisiones antiguas del repositorio público deben cambiarse si siguen vigentes.
Eliminar el valor de la versión actual no lo elimina del historial de Git.

Prueba manual en dos terminales:

```sh
npm start
```

```sh
cd "$HOME/HHR-laboratorio"
npm run tunnel:ngrok
```

Ngrok se inicia con inspección deshabilitada para no capturar solicitudes clínicas.
El dominio debe ser de tu cuenta y apuntar a `http://127.0.0.1:3100`; no reutilices un dominio
histórico sin verificarlo. Ejecuta `npm run check:syslab` desde otra terminal: usa la clave
local sin imprimirla y comprueba la sesión tanto por loopback como por el túnel.
La comprobación directa de la página de Syslab es orientativa; no consulta pacientes.

## Arranque automático en macOS

Después de que las pruebas manuales pasen, detén ambos procesos manuales y ejecuta:

```sh
npm run mac:install-agent
```

Instala únicamente `cl.hhr.syslab` y `cl.hhr.syslab-tunnel` en los LaunchAgents de tu usuario.
Reejecutarlo actualiza esos mismos servicios. Usa rutas absolutas para Node y ngrok;
`caffeinate -i` evita suspensión por inactividad mientras el servidor está activo.
Requiere iniciar sesión después de reiniciar, especialmente con FileVault. No evita un
corte de energía ni enciende un Mac apagado. No cambies la carpeta ni Node sin reinstalar
los agentes. Para revisar el estado:

```sh
launchctl print "gui/$(id -u)/cl.hhr.syslab"
launchctl print "gui/$(id -u)/cl.hhr.syslab-tunnel"
```

El instalador imprime los comandos de detención. Cloudflare Tunnel es compatible con el
servidor, pero su servicio se instala por separado; el instalador automático usa ngrok.

## Configurar Netlify y activar

Sitio de HHR actual: `testinghhr` / `https://hhr-hospitalizados.app`.
Variables del sitio, nunca en código ni en `netlify.toml`:

- `SYSLAB_API_TOKEN`: secreto, alcance **Functions**, mismo valor que `.env` del Mac.
- `SYSLAB_PROXY_URL`: URL HTTPS confirmada del túnel; alcance **Functions**.
- `VITE_SYSLAB_TRANSPORT`: `remote`, alcance **Builds**, solo después de comprobar el Mac.

Las variables se incorporan a un despliegue nuevo; guardarlas no modifica uno ya publicado.
No copies usuario/contraseña Syslab a Netlify. La función conserva la autorización Firebase
por rol; la clave compartida protege la conexión entre servidores y no llega al navegador.
Antes de activar, comprobar `/health` autenticado y después una consulta autorizada del
paciente correcto desde HHR, incluyendo PDF, análisis y desconexión del Mac. La prueba local
sintética no acredita acceso al Syslab real.

Para revertir al flujo actual, poner `VITE_SYSLAB_TRANSPORT=extension` y desplegar de nuevo.
Conservar la clave para reinstalar el servidor; no desproteger el túnel.

## Desarrollo y pruebas

```sh
npm ci
npx playwright install chromium
npm test -- --runInBand
```

Las pruebas incluyen un portal Syslab HTTP local y PDF completamente sintéticos: búsqueda,
sesión/cookies, descarga, análisis, identidad equivocada, referencias vencidas, autenticación
y fallo sin filtración de excepciones. No requieren la LAN del hospital ni credenciales.

Los logs contienen estado operativo, nunca RUT, rutas de informes, HTML, texto clínico,
contraseñas ni capturas. No se guardan PDFs en disco. Los archivos de log del servidor rotan;
los logs de LaunchAgent deben supervisarse como cualquier servicio local.

`technical_data_access.md` describe el scraper anterior y es histórico. El contrato vigente
para instalar y conectar HHR es este README y el código de la versión 2.
