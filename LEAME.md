# Automatización de Consulta Syslab

Para cumplir con el objetivo de priorizar el *flujo de automatización* de la consulta en tu intranet (`http://10.4.69.90/syslab/`), he diseñado este pequeño servidor web usando **Node.js, Express y Playwright**. 

La arquitectura básica que te puede servir para tu futura web app es:
1. **Frontend**: Pide un número de RUT y lo envía al backend.
2. **Backend (API)**: Recibe el RUT e inicia un "Robot" usando el engine Chromium de forma invisible usando Playwright.
3. **El Robot (Playwright)**: 
   - Entra a la web local Syslab.
   - Trata de detectar los campos "Usuario / Contraseña" mediante selectores robustos y los rellena con tus credenciales.
   - Da clic en los botones leyendo su valor según las imágenes de referencia `"Búsqueda por RUT"` y `"Aceptar"`.
   - Lee el contenido final.
   
> **Nota de Extracción:** Al no conocer la estructura de las "Tablas de Resultados" del portal (no mostrada en las capturas), la etapa final del macro de Playwright actualmente genera un Screenshot (captura de web simulada completa) como _prueba de concepto_ para validar que el login y la búsqueda funcionan hasta ese punto. En la práctica, ese paso debería cambiarse de un `page.screenshot` a código que lea las celdas, filas e inputs de la tabla usando `page.locator()` para escupir un archivo JSON a tu Web App final.

## 🚀 Cómo Testear Este Flujo en tu Entorno Local

Dado que yo (el Agente) no cuento con acceso a tu Intranet de `10.4.69.90`, debes correr este programa en tu ordenador. Abre la terminal (`Terminal.app` u otra) en la carpeta donde esté alojado este README y ejecuta el siguiente paso a paso:

### 1. Requisitos Previos: 
Debes contar con **Node.js** instalado en tu Mac.  
*(Puedes verificar con `node -v` y `npm -v` en la terminal).*

### 2. Instala los empaquetados:
Instala Playwright y Express:
```bash
npm install
```

### 3. Instala los binarios del navegador "Robot":
Para que playwright pueda funcionar, debes descargar la instancia controlable del navegador Chromium de esta forma:
```bash
npx playwright install --with-deps chromium
```

### 4. Corre el Backend/API en tu Computador:
Una vez instalado, corre el proyecto:
```bash
npm start
```

### 5. Utiliza la Web UI:
Abre tu navegador de confianza y ve a la dirección **`http://localhost:3000`**.  
¡Ahí tendrás la interfaz para probar la integración y pedir el RUT! El servidor hará el puente entre tu Intranet en la LAN y la app front-end devolviéndote el último pantallazo capturado.

---

## 🛠️ Debug y Customizaciones 

Si el robot falla al hacer clic a algún campo (tal vez porque no es un `<input>` si no un `<button>` estándar de HTML), abre `scraper.js` y busca la línea del problema. 

Si te cuesta saber qué está pasando *tras bambalinas*, simplemente abre `scraper.js` y cambia la línea:
```javascript
const browser = await chromium.launch({ headless: true });
```
por:
```javascript
const browser = await chromium.launch({ headless: false });
```

Esto quitará del modo fantasma a Playwright, y el navegador Chrome/Chromium se abrirá de verdad frente a ti y llenará los datos solito. Podrás frenar la app temporalmente con un `await page.waitForTimeout(5000);` para diagnosticar por qué no funciona el logueo, en caso de fallar en la forma de tus elementos html internos.
