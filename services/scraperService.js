const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');

class ScraperService {
  constructor() {
    this.baseUrl = 'http://10.4.69.90/syslab/';
    this.user = '17752753';
    this.pass = '17752753';
    this.logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(this.logsDir)) fs.mkdirSync(this.logsDir);
  }

  async _initBrowser(headless = true) {
    return await chromium.launch({ 
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });
  }

  async getExamsList(rut) {
    const browser = await this._initBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    try {
      await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
      await this._login(page);
      await this._navigateToSearchByRut(page);
      await this._performSearch(page, rut);
      const exams = await this._extractExamsTable(page);
      const screenshot = await page.screenshot({ fullPage: true });
      await browser.close();
      return { success: true, data: exams, screenshot: `data:image/png;base64,${screenshot.toString('base64')}` };
    } catch (error) {
      if (browser) await browser.close();
      throw error;
    }
  }

  async getExamsDetails(links) {
    const browser = await this._initBrowser();
    const context = await browser.newContext({ acceptDownloads: true });
    const results = [];

    try {
      const mainPage = await context.newPage();
      await mainPage.goto(this.baseUrl, { waitUntil: 'networkidle' });
      await this._login(mainPage);
      await mainPage.close();

      for (const link of links) {
        console.log(`[DEBUG] Procesando reporte: ${link}`);
        const page = await context.newPage();
        let textContent = "";

        try {
          // Intentar captura múltiple: Descarga vs Navegación Directa vs Buffer de Respuesta
          const [ response ] = await Promise.all([
            page.waitForResponse(res => res.url().includes('detalleexamenes.php'), { timeout: 15000 }).catch(() => null),
            page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
            page.goto(link, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null)
          ]);

          if (response && response.headers()['content-type']?.includes('pdf')) {
            console.log(`[DEBUG] Respuesta PDF detectada vía red.`);
            const buffer = await response.buffer();
            const data = await pdf(buffer);
            textContent = data.text;
          } else {
            // Fallback al DOM o a lo que haya cargado
            textContent = await page.innerText('body').catch(() => "");
          }

          // Debugging log para inspección manual (el usuario podrá ver esto en el terminal)
          console.log(`[DEBUG RAW TEXT START]\n${textContent}\n[DEBUG RAW TEXT END]`);
          
          // Guardar para auditoría
          fs.writeFileSync(path.join(this.logsDir, `raw_extract_${Date.now()}.txt`), textContent);

          const findings = this._parseReportText(textContent);
          results.push({ url: link, findings });

        } catch(e) {
          console.error(`[DEBUG ERROR] Fallo en ${link}:`, e.message);
          results.push({ url: link, findings: [], error: e.message });
        } finally { await page.close(); }
      }

      await browser.close();
      return { success: true, data: results };
    } catch (error) {
      if (browser) await browser.close();
      throw error;
    }
  }

  _parseReportText(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const parsedData = [];
    let currentSection = 'GENERAL';

    // Regex mucho más flexible para el texto sucio de PDF
    // 1. Grupo: Análisis (puede incluir espacios)
    // 2. Separador opcional (:)
    // 3. Grupo: Resultado (números, comas, puntos, <, >)
    // 4. Grupo: Unidad
    // 5. Separador opcional (| o I o espacio largo)
    // 6. Grupo: Referencia
    const flexibleRegex = /([A-Z\s\+\d\/\-\(\)\.\%]+?)\s*[:]?\s*([\d\.\,<>]+)\s*([A-Za-z\/\d\%]*)\s*[|I\s]+([^|I\n\r]+)/;

    for (let line of lines) {
      line = line.trim();
      if (!line || line.length < 4) continue;

      // Detectar secciones (Títulos en mayúsculas sin números cerca de los dos puntos)
      if (line.match(/^[A-Z\s\+\/]{5,35}$/) && !line.includes('RESULTADO') && !line.includes('FECHA')) {
        currentSection = line;
        continue;
      }

      const match = line.match(flexibleRegex);
      if (match) {
        const analysis = match[1].trim();
        // Filtrar ruidos comunes de cabeceras
        if (analysis.length < 3 || analysis.includes('PROCEDENCIA') || analysis.includes('EDAD')) continue;

        parsedData.push({
          section: currentSection,
          analysis: analysis,
          result: match[2].trim(),
          unit: match[3].trim(),
          refValue: match[4].trim()
        });
      }
    }

    return parsedData;
  }

  async _login(page) {
    try {
      console.log('[DEBUG] Intentando login...');
      const userInput = page.locator('input[name="usuario"], input[type="text"]').first();
      const passInput = page.locator('input[name="password"], input[type="password"]').first();
      
      await userInput.waitFor({ state: 'visible', timeout: 10000 });
      await userInput.fill(this.user);
      await passInput.fill(this.pass);
      
      const loginBtn = page.locator('input[value="Ingresar"], button:has-text("Ingresar"), input[type="submit"]').first();
      await loginBtn.click();
      
      // Esperar a que el botón de login desaparezca o cambie la URL
      await page.waitForLoadState('networkidle');
      
      // Verificar si hay mensaje de error
      const errorMsg = await page.innerText('body');
      if (errorMsg.toLowerCase().includes('incorrecto') || errorMsg.toLowerCase().includes('error')) {
        console.warn('[DEBUG] Posible error en login detectado en el texto de la página.');
      }
    } catch (e) {
      await page.screenshot({ path: path.join(this.logsDir, `login_error_${Date.now()}.png`) });
      throw new Error(`Falla en Login: ${e.message}`);
    }
  }

  async _navigateToSearchByRut(page) {
    try {
      console.log('[DEBUG] Buscando botón "Búsqueda por RUT"...');
      // Intentar múltiples selectores comunes para este botón
      const searchBtn = page.locator('input[value*="RUT"], button:has-text("RUT"), a:has-text("RUT")').first();
      await searchBtn.waitFor({ state: 'visible', timeout: 15000 });
      await searchBtn.click();
      await page.waitForLoadState('networkidle');
    } catch (e) {
      await page.screenshot({ path: path.join(this.logsDir, `nav_error_${Date.now()}.png`) });
      throw new Error(`No se encontró el botón de búsqueda: ${e.message}`);
    }
  }

  async _performSearch(page, rut) {
    try {
      console.log(`[DEBUG] Ejecutando búsqueda para: ${rut}`);
      const rutInput = page.locator('input[name="rut"], input[type="text"]').first();
      await rutInput.waitFor({ state: 'visible', timeout: 10000 });
      await rutInput.fill(rut);
      const acceptBtn = page.locator('input[value*="Aceptar"], button:has-text("Aceptar")').first();
      await acceptBtn.click();
      await page.waitForLoadState('networkidle');
    } catch (e) {
      await page.screenshot({ path: path.join(this.logsDir, `search_error_${Date.now()}.png`) });
      throw new Error(`Falla en búsqueda por RUT: ${e.message}`);
    }
  }

  async _extractExamsTable(page) {
    return await page.$$eval('table.narrow tr.odd, table.narrow tr.even', rows => {
      return rows.map(row => {
        const tds = row.querySelectorAll('td');
        if (tds.length < 6) return null;
        const aTag = tds[0].querySelector('a');
        const href = aTag ? aTag.getAttribute('href') : '';
        const id = aTag ? aTag.innerText.trim() : tds[0].innerText.trim();
        const rawDate = tds[1].innerHTML; 
        const dateParts = rawDate.split('<br>');
        const date = dateParts[0] ? dateParts[0].trim() : tds[1].innerText.trim();
        const time = dateParts[1] ? dateParts[1].replace(/<[^>]+>/g, '').trim() : '';
        const patientName = tds[3].innerText.trim();
        const origin = tds[4].innerText.trim();
        const examsTags = Array.from(tds[5].querySelectorAll('.mitabla tr td'));
        const examNames = examsTags.map(td => td.innerText.replace(/\(V\)|\(P\)/g, '').trim()).filter(e => e !== '');
        return { id, link: href ? `http://10.4.69.90/syslab/${href.trim()}` : null, date, time, patientName, origin, exams: examNames };
      }).filter(Boolean);
    });
  }
}

module.exports = new ScraperService();
