# Documentación Técnica de Acceso de Datos

Este documento describe la arquitectura y los pasos técnicos implementados en **Syslab Scraper** para extraer, acceder y consolidar los datos de pacientes desde el portal interno Syslab (`http://10.4.69.90/syslab/`).

## Flujo de Orquestación General

El proyecto se expone como una API REST (Express) la cual recibe las peticiones. Para realizar la extracción, se utiliza **Playwright**, una herramienta de automatización de navegadores que orquesta Chromium en modo `headless`. El comportamiento de Playwright permite navegar sobre una red que no posee una API pública y funciona accediendo e interactuando con el DOM (Document Object Model) de la página como si de un usuario se tratase.

El ruteo se concentra en `routes/api.js` y el procesamiento se localiza en `services/scraperService.js`.

---

## 1. Módulo de Listado de Exámenes (`/api/exams`)

Este flujo se encarga de determinar qué exámenes están vinculados a un paciente usando su RUT. Los pasos técnicos son:

1. **Inicialización del Navegador**:
   Se lanza una instancia de Chromium que desactiva el renderizado gráfico (Headless) e ignora mecanismos de seguridad de web cruzada (`--disable-web-security`).

2. **Proceso de Autenticación (`_login`)**: 
   Se navega al portal principal. Se ubican los inputs de `usuario` y `password` en el DOM usando selectores específicos y genéricos. 
   - *Consideración técnica:* Por defecto, utiliza credenciales de administración ancladas en variables de entorno o pre-configuradas. Espera hasta la carga completa (`networkidle`).

3. **Navegación al Módulo de Búsqueda de RUT (`_navigateToSearchByRut`)**:
   Ubica en la interfaz el botón que permite hacer filtros por RUT y se simula el click de navegación.

4. **Búsqueda e Inyección de Datos (`_performSearch`)**:
   Una vez en el portal de búsqueda, ubica el campo `rut`, inyecta el valor proveído en el frontend o endpoint y activa la búsqueda (Click en botón "Aceptar"). 

5. **Lectura y Estructuración de Tabla (`_extractExamsTable`)**:
   - Una vez cargados los resultados, Playwright inyecta código JavaScript directo al entorno del cliente para buscar la tabla de datos (`table.narrow tr.odd, table.narrow tr.even`).
   - Lee identificadores, extrae la fecha, quita etiquetas HTML adicionales (`<br>`), extrae el paciente, la procedencia y construye la lista de URLs relativas correspondientes a cada análisis.

---

## 2. Módulo de Extracción de Resultados (`/api/exams/details`)

El proceso más complejo consiste en extraer la data empírica y los análisis puntuales a partir de los documentos en formato PDF almacenados en el listado previo.

1. **Gestión de Instancias Concurrentes**:
   Se inicia un contexto de navegador nuevo configurado para aceptar descargas en disco (`acceptDownloads: true`).

2. **Interceptación de Red y Fallback Complejo**:
   Para cada link, el servicio instaura un mecanismo de carrera asíncrona (`Promise.all`) con los siguientes "EventsListeners":
   - Evalúa si el Servidor de Origen arroja una respuesta en red (`page.waitForResponse`) captando el recurso que apunta a `detalleexamenes.php`.
   - Espera eventos de la API de Descarga nativa (`page.waitForEvent('download')`).
   - Intenta navegar directamente al PDF o la vista interactiva (`page.goto`).

3. **Extracción y Procesamiento de PDF**:
   Si el Content-Type captado por medio del sniffer de red es un PDF:
   - Se convierte la descarga en un _buffer_ crudo de bytes.
   - El Buffer se lo pasa a la biblioteca **`pdf-parse`**, la cual escanea y produce una transformación texto-plano del archivo binario.
   - *Mecanismo de Fallback*: Si no detecta PDF, recupera todo el DOM de la página con `page.innerText('body')`.

4. **Motor de Parseo de Texto Crudo (`_parseReportText`)**:
   El documento es transformado desde una representación cruda, caótica y no estructurada a un formato JSON coherente.
   El flujo es el siguiente:
   - Identifica y diferencia el contexto para agrupar variables dentro de categorías macro utilizando la detección de líneas en Mayúscula (Ej. `HEMOGRAMA` o `PERFIL BIOQUÍMICO`).
   - **Expresión Regular (RegEx)**: Se utiliza el algoritmo `/([A-Z\s\+\d\/\-\(\)\.\%]+?)\s*[:]?\s*([\d\.\,<>]+)\s*([A-Za-z\/\d\%]*)\s*[|I\s]+([^|I\n\r]+)/` para extraer.
   - Esta Regex detecta en cada línea el nombre del análisis, busca un posible dos puntos (`:`), obtiene el valor arrojado, luego detecta la unidad de medida, ignora barras `| o I` y recupera finalmente los valores de Referencia.

## Resumen de Herramientas de Extracción

- **Playwright**: Simulación de navegación DOM, llenado de variables de interacción, e inyección de JS cliente.
- **Node Buffer & Network Interceptor**: Permite el espionaje de headers en los request a la clínica, evitando descargas ciegas.
- **pdf-parse**: Motor extractivo off-line de los buffers capturados en red.
- **Expresiones Regulares Complejas**: Transforman el log crudo devuelto por el PDF en una tabla relacional usable para el front-end.
