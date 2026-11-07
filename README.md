# Puente de laboratorio Syslab para HHR

Servidor local Node.js/Express/Playwright. Se instala en el Mac mini que puede acceder a
Syslab y a Internet. HHR en Netlify autentica al profesional con Firebase y consulta este
servidor por un túnel HTTPS. No requiere Google Cloud ni abrir puertos en el router.

## Contrato con HHR actual

Todas las rutas exigen `Authorization: Bearer <SYSLAB_API_TOKEN>`. El servidor escucha por
defecto en `127.0.0.1:3100`. No expone la interfaz web anterior sin autenticación.

- `GET /health`: inicia sesión en Syslab; `connected:true` acredita esa sesión, no solo un proceso encendido.
- `GET /live`: comprueba únicamente el proceso, con el mismo Bearer y sin consultar pacientes ni iniciar sesión. Lo usa el supervisor.
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

## Recuperación de servidor y túnel sin sesión de escritorio

El instalador de servicios reemplaza los dos LaunchAgents por LaunchDaemons del sistema.
**Los procesos siguen ejecutándose con el usuario habitual, nunca como root.** Arrancan
cuando el volumen de datos ya está desbloqueado; no requieren entrar al escritorio.
Mantiene FileVault, las credenciales locales, el dominio y el acceso exclusivamente por
loopback. No crea contraseñas, inicio automático de usuario ni accesos públicos SSH.

Con el código actualizado en `~/HHR-laboratorio` y las dependencias/navegador instalados:

```sh
cd "$HOME/HHR-laboratorio"
node scripts/install-mac-services.js --prepare
sudo "$(command -v node)" scripts/install-mac-services.js
```

`--prepare` valida los plists sin instalar ni cambiar energía. El segundo comando exige
la autorización normal de administrador. Instala `/Library/LaunchDaemons/cl.hhr.syslab.plist`
y `cl.hhr.syslab-tunnel.plist`, conserva una copia de los agentes anteriores en `logs/`,
y activa `pmset -a autorestart 1` (encendido tras un corte inesperado). Un apagado manual
no es un corte de luz y este ajuste no garantiza encendido después de apagar normalmente.
No cambia suspensión global ni FileVault. Si falla, retira las definiciones nuevas e intenta
restaurar las anteriores; comprueba siempre los estados antes de reiniciar.

La supervisión se ejecuta cada 30 segundos, sin checks simultáneos. Usa `/live` autenticado:
un fallo de sesión Syslab no se confunde con un proceso muerto. Deja 60 segundos de gracia;
tras tres fallos consecutivos termina el proceso afectado y lo vuelve a iniciar.
El agente ngrok se comprueba localmente cada 30 segundos; la prueba por Internet se limita
a una cada cinco minutos para evitar tráfico innecesario. Las comprobaciones externas
aplazadas no borran fallos previos ni incrementan su cuenta. Ngrok conserva también su reconexión nativa durante cortes breves.
Si el servidor local está caído no reinicia el túnel, y una respuesta 401/403 pide revisar
credenciales sin entrar en un bucle. Nunca repite consultas clínicas ni descarga informes.

Hay como máximo tres arranques por componente en una ventana de 15 minutos; el presupuesto
se conserva en `logs/recovery-server.json` y `recovery-tunnel.json` con permisos 600, incluso
si muere el supervisor. Una vez consumido, espera hasta que haya cupo. Los estados contienen
solo PIDs, tiempos y códigos operativos. Los logs operativos rotan; se descarta la salida
cruda de ngrok y los procesos hijos. Reiniciar Node/ngrok manualmente sin supervisión
no debe convivir con estos servicios: duplicaría procesos sobre los mismos puertos.

```sh
launchctl print system/cl.hhr.syslab
launchctl print system/cl.hhr.syslab-tunnel
cat logs/recovery-server.json
cat logs/recovery-tunnel.json
npm run check:syslab
```

### FileVault y recuperación tras un arranque en frío

El disco **debe desbloquearse**: el propio túnel no puede arrancar antes de que sus archivos
estén disponibles. En Apple silicon con macOS 26 o posterior, Remote Login permite ese
desbloqueo por SSH mediante la contraseña de un usuario autorizado. Después del desbloqueo
la conexión SSH se cierra brevemente y macOS inicia sus servicios. No hace falta iniciar
una sesión gráfica para los LaunchDaemons. Referencias de Apple:
[FileVault y SSH](https://support.apple.com/guide/security/sec8447f5049/web),
[manual OpenSSH](https://github.com/apple-oss-distributions/OpenSSH/blob/main/apple_ssh_and_filevault.7).

Se necesita conectividad independiente hasta la red del Mac: una VPN que dependa del
propio Mini o ngrok no sirven mientras su disco siga bloqueado. Desde otro equipo con
acceso directo o una VPN independiente: `ssh tu_usuario@ip_del_mini`. No publiques SSH
en Internet ni desactives FileVault. Para automatizar también ese desbloqueo se necesita
un segundo equipo disponible y una decisión explícita sobre custodia de credenciales.
Este instalador no guarda la contraseña de macOS ni la clave de recuperación.

Si aún no puedes autorizar cambios de administrador, puedes activar la misma supervisión
en los agentes actuales: `node scripts/install-mac-services.js --user`. Recupera procesos y
conexión mientras la sesión del usuario exista, sin modificar energía. No equivale al
arranque sin escritorio: la instalación de sistema sigue pendiente. La posterior migración
retira esos agentes para evitar duplicarlos. No instales agentes si ya existen los servicios
de sistema; el instalador lo rechaza.

Antes de una prueba real de reinicio, verifica el canal de desbloqueo y la posibilidad de
recuperar acceso. Las pruebas de procesos y portal ficticio no acreditan un arranque real
con FileVault bloqueado. Un UPS reduce cortes; el software no sustituye electricidad y red.
## Cola de laboratorio y bandeja del censo

El gateway Netlify autentica y autoriza cada petición con Firebase y añade
`X-HHR-Lab-Owner`, SHA-256 del proyecto, UID verificado y hospital. Nunca se toma
el operador del navegador. Además se exige el Bearer privado ya existente.
La revisión de resultados es personal por operador, paciente y episodio.

- `POST /api/jobs/details` `{links}`: admite hasta 500 informes de un mismo RUN,
  verifica las referencias antes de admitirlos y responde 202 sin esperar a Syslab.
- `POST /api/jobs/census` `{patients:[{rutBody,episodeId,admissionDate}],censusDate,force?}`:
  captura entre 1 y 60 sujetos, excluye fechas fuera del episodio/período y consulta
  una vez cada orden nueva o con cambios de validación. `force:true` relee las
  conocidas para comprobar correcciones que no cambien la lista de Syslab.
- `GET /api/jobs/:id`: estado y progreso, sin el contenido completo del trabajo.
- `GET /api/jobs/:id/result?offset=0`: páginas completas de resultados de un trabajo
  finalizado; `index` y `omittedIndices` remiten a las posiciones admitidas. Cada
  página es de hasta 50 informes y 1 MiB. El cliente valida cobertura completa
  antes de publicar el análisis. Dos ventanas pueden compartir un trabajo activo.
- `POST /api/jobs/:id/cancel` y `/retry`: cancelación o reintento explícitos;
  conservan los puntos ya confirmados. Una lectura en curso puede finalizar pero
  su resultado no se publica después de cancelar.
- `POST /api/census/state` con la misma cohorte y `offset`/`onlyUnread` opcionales:
  bandeja paginada, conteo sin revisar y trabajos de ese día. Renueva los enlaces
  de PDF para esa lectura, sin enviar rutas internas de Syslab.
- `POST /api/census/review` `{id,revision}`: confirma sólo la versión que se revisó;
  una versión cambiada exige nueva lectura y revisión.

El primer barrido presenta los informes disponibles como sin revisar; no afirma
que todos sean recién emitidos. Las órdenes explícitamente sin exámenes validados
se contabilizan como pendientes y se vuelven a consultar. Un fallo de red, identidad
u otro formato no se convierte en ausencia de resultados. Se conserva lo conocido
si falla una actualización. No escribe el censo ni Firebase.

Un único trabajador limita la carga sobre Syslab y reutiliza una sesión por trabajo
de informes o por paciente del censo. Las peticiones de HHR sólo crean trabajo y
consultan progreso; el trabajador continúa al cerrar el navegador. El acceso y la
presentación se vuelven a autorizar, y cambiar de sesión descarta las respuestas
pendientes del navegador.

La cola y sus resultados se guardan con AES-256-GCM en `state/laboratory.enc`, con
clave independiente en `state/laboratory.key` (directorio 700, archivos 600), bajo
FileVault. `SYSLAB_STATE_DIR` permite elegir otro directorio local. Ambas piezas
se respaldan juntas, de forma privada: perder la clave hace ilegible el archivo.
La ausencia de clave o un archivo dañado detienen el servicio; nunca se reinicia
la cola vacía. Las escrituras son atómicas y sincronizadas a disco. Una falta de
espacio no confirma trabajo; recuperar espacio y reintentar conserva lo confirmado.
No se purga trabajo por antigüedad ni número de fallos; el límite de 64 MiB rechaza
más escrituras y requiere mantenimiento explícito. No borrar `state/` al actualizar.

Los trabajos interrumpidos vuelven a la cola al arrancar. Una prueba sintética con
portal autenticado, PDFs originales y 32 órdenes (una pendiente) acredita el flujo;
no acredita un paciente real ni un reinicio en frío del Mac con FileVault bloqueado.

## Período de la actualización del censo

`POST /api/jobs/census` y `POST /api/census/state` aceptan opcionalmente
`dateRange: { from: "2026-10-01", to: "2026-11-07" }` (días ISO, extremos incluidos).
Sin ese campo se conserva el comportamiento anterior: desde el ingreso propio de cada
paciente hasta `censusDate`. `censusDate` sigue identificando la cohorte, no se sustituye
por el fin del rango personalizado. El rango explícito puede incluir antecedentes previos
al ingreso o resultados posteriores al día censal; no cambia el episodio ni escribe el censo.
Se valida el mismo rango al crear el trabajo y leer su bandeja, y queda conservado en la
cola tras un reinicio. Los filtros no borran informes ni revisiones de otros períodos.
No hay una ventana máxima en días: rigen la disponibilidad de Syslab y el máximo vigente
de 500 informes por paciente y trabajo; excederlo se informa como fallo, sin truncar resultados.
