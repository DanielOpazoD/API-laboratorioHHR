const browserManager = require('./browserManager');
const { parseReportText } = require('../utils/reportParser');
const logger = require('../utils/logger');
const config = require('../config/env');
const { PDFParse } = require('pdf-parse');
const path = require('path');
const fs = require('fs');

const DETAILS_CONCURRENCY = 3;

class ScraperOrchestrator {
  async mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    const workerCount = Math.min(Math.max(concurrency, 1), items.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    });

    await Promise.all(workers);
    return results;
  }

  async getExamsList(rut) {
    let browser, context, page;
    try {
      browser = await browserManager.initBrowser();
      context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      page = await context.newPage();
      
      await page.goto(config.syslab.baseUrl, { waitUntil: 'networkidle' });
      await browserManager.login(page);
      
      logger.info('Buscando botón "Búsqueda por RUT"...');
      const searchBtn = page.locator('input[value*="RUT"], button:has-text("RUT"), a:has-text("RUT")').first();
      await searchBtn.waitFor({ state: 'visible', timeout: 15000 });
      await searchBtn.click();
      await page.waitForLoadState('networkidle');

      // Syslab exige RUT sin puntos, sin guion y sin dígito verificador
      const cleanRut = String(rut).replace(/\./g, '').replace(/-.*$/, '').replace(/\D/g, '');
      logger.info(`Buscando RUT: ${rut} (normalizado: ${cleanRut})`);
      const rutInput = page.locator('input[name="rut"], input[type="text"]').first();
      await rutInput.waitFor({ state: 'visible', timeout: 10000 });
      await rutInput.fill(cleanRut);
      
      const acceptBtn = page.locator('input[value*="Aceptar"], button:has-text("Aceptar")').first();
      await acceptBtn.click();
      await page.waitForLoadState('networkidle');

      // === DIAGNÓSTICO: dumpear HTML y URL post-Aceptar para ver dónde caímos ===
      try {
        const fsd = require('fs');
        const pathd = require('path');
        const debugDir = pathd.join(__dirname, '../logs');
        if (!fsd.existsSync(debugDir)) fsd.mkdirSync(debugDir, { recursive: true });
        const ts = Date.now();
        const html = await page.content();
        fsd.writeFileSync(pathd.join(debugDir, `debug_post_aceptar_${ts}.html`), html);
        logger.info(`[DEBUG] post-Aceptar URL=${page.url()} | title="${await page.title()}" | htmlLen=${html.length}`);
        const frames = page.frames();
        logger.info(`[DEBUG] frames: ${frames.length} -> ${frames.map(f=>f.url()).join(' | ')}`);
        const buttons = await page.$$eval('input[type=submit], input[type=button], button, a', els =>
          els.map(e => ({ tag: e.tagName, value: e.value || e.innerText || '', href: e.href || '', name: e.name || '' })).filter(x => x.value || x.href)
        ).catch(() => []);
        logger.info(`[DEBUG] clickables on page: ${JSON.stringify(buttons).slice(0,1500)}`);
      } catch (debugErr) {
        logger.warn(`[DEBUG] dump failed: ${debugErr.message}`);
      }
      // === FIN DIAGNÓSTICO ===

      const exams = await page.$$eval('table.narrow tr.odd, table.narrow tr.even', rows => {
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
          const link = href ? new URL(href.trim(), window.location.href).href : null;
          return { id, link, date, time, patientName, origin, exams: examNames };
        }).filter(Boolean);
      });

      const screenshot = await page.screenshot({ fullPage: true });
      return { success: true, data: exams, screenshot: `data:image/png;base64,${screenshot.toString('base64')}` };
    } catch (e) {
      logger.error(`Error en getExamsList: ${e.message}`);
      throw e;
    } finally {
      if (browser) await browser.close();
    }
  }

  async getExamPdf(link) {
    let browser, context, page;
    try {
      browser = await browserManager.initBrowser();
      context = await browser.newContext({ acceptDownloads: true });
      const loginPage = await context.newPage();
      await loginPage.goto(config.syslab.baseUrl, { waitUntil: 'networkidle' });
      await browserManager.login(loginPage);
      await loginPage.close();

      page = await context.newPage();

      // Estrategia 1: listener que lee el body apenas llega una respuesta PDF
      let capturedPdfBuffer = null;
      page.on('response', async (response) => {
        if (capturedPdfBuffer) return;
        const ct = (response.headers()['content-type'] || '').toLowerCase();
        if (!ct.includes('pdf')) return;
        try {
          const body = await response.body();
          if (body && body.length > 0) {
            capturedPdfBuffer = body;
            logger.info(`PDF capturado vía response listener: ${response.url()} (${body.length} bytes)`);
          }
        } catch (e) {
          logger.warn(`No se pudo leer body de ${response.url()}: ${e.message}`);
        }
      });

      // Estrategia 2: listener para descarga nativa
      let downloadedPath = null;
      page.on('download', async (download) => {
        try {
          const tmpPath = path.join(__dirname, '../downloads', `pdf_${Date.now()}.pdf`);
          await download.saveAs(tmpPath);
          downloadedPath = tmpPath;
          logger.info(`PDF descargado vía download event: ${tmpPath}`);
        } catch (e) {
          logger.warn(`No se pudo guardar download: ${e.message}`);
        }
      });

      // Navegar al link
      await page.goto(link, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => {
        logger.warn(`goto no completó networkidle: ${e.message}`);
      });

      // Dar tiempo para que los listeners procesen respuestas tardías
      await page.waitForTimeout(2000);

      if (capturedPdfBuffer) return capturedPdfBuffer;

      if (downloadedPath) {
        const buffer = fs.readFileSync(downloadedPath);
        fs.unlinkSync(downloadedPath);
        return buffer;
      }

      // Estrategia 3: buscar iframe/embed con PDF dentro de la página cargada
      const embeddedPdfUrl = await page.evaluate(() => {
        const candidates = [
          ...document.querySelectorAll('iframe[src]'),
          ...document.querySelectorAll('embed[src]'),
          ...document.querySelectorAll('object[data]'),
          ...document.querySelectorAll('a[href*=".pdf"]'),
        ];
        for (const el of candidates) {
          const url = el.src || el.data || el.href;
          if (url && url.toLowerCase().includes('pdf')) return url;
        }
        return null;
      }).catch(() => null);

      if (embeddedPdfUrl) {
        logger.info(`PDF embebido detectado, navegando a: ${embeddedPdfUrl}`);
        await page.goto(embeddedPdfUrl, { timeout: 20000 }).catch(() => null);
        await page.waitForTimeout(2000);
        if (capturedPdfBuffer) return capturedPdfBuffer;
      }

      // Estrategia 4: última opción — renderizar HTML como PDF
      logger.warn('Ningún PDF nativo detectado; generando PDF desde el HTML renderizado');
      const pageTitle = await page.title().catch(() => 'unknown');
      const currentUrl = page.url();
      logger.info(`Título página: "${pageTitle}" | URL actual: ${currentUrl}`);
      return await page.pdf({ format: 'A4', printBackground: true });

    } catch (e) {
      logger.error(`Error en getExamPdf: ${e.message}`);
      throw e;
    } finally {
      if (browser) await browser.close();
    }
  }

  async processExamDetailLink(context, link, logsDir, index) {
    logger.info(`Procesando link: ${link}`);
    const page = await context.newPage();
    let textContent = "";

    try {
      let capturedPdfBuffer = null;
      page.on('response', async (response) => {
        if (capturedPdfBuffer) return;
        const ct = (response.headers()['content-type'] || '').toLowerCase();
        if (!ct.includes('pdf')) return;
        try {
          const body = await response.body();
          if (body && body.length > 0) {
            capturedPdfBuffer = body;
            logger.info(`PDF capturado (details) vía response: ${response.url()} (${body.length} bytes)`);
          }
        } catch (e) {
          logger.warn(`No se pudo leer body (details): ${e.message}`);
        }
      });

      let downloadedPath = null;
      page.on('download', async (download) => {
        try {
          const tmpPath = path.join(__dirname, '../downloads', `details_${Date.now()}_${index}.pdf`);
          await download.saveAs(tmpPath);
          downloadedPath = tmpPath;
          logger.info(`PDF descargado (details) vía download: ${tmpPath}`);
        } catch (e) {
          logger.warn(`No se pudo guardar download (details): ${e.message}`);
        }
      });

      await page.goto(link, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
      await page.waitForTimeout(2500);

      let pdfBuffer = capturedPdfBuffer;
      if (!pdfBuffer && downloadedPath) {
        pdfBuffer = fs.readFileSync(downloadedPath);
        fs.unlinkSync(downloadedPath);
      }

      if (pdfBuffer) {
        const parser = new PDFParse({ data: pdfBuffer });
        const data = await parser.getText();
        textContent = data.text;
      } else {
        textContent = await page.innerText('body').catch(() => "");
      }

      fs.writeFileSync(path.join(logsDir, `raw_extract_${Date.now()}_${index}.txt`), textContent);
      const findings = parseReportText(textContent);
      return { url: link, findings };
    } catch (e) {
      logger.error(`Fallo en details ${link}: ${e.message}`);
      return { url: link, findings: [], error: e.message };
    } finally {
      await page.close();
    }
  }

  async getExamsDetails(links) {
    let browser, context, mainPage;
    try {
      browser = await browserManager.initBrowser();
      context = await browser.newContext({ acceptDownloads: true });
      mainPage = await context.newPage();
      
      await mainPage.goto(config.syslab.baseUrl, { waitUntil: 'networkidle' });
      await browserManager.login(mainPage);
      await mainPage.close();

      const logsDir = path.join(__dirname, '../logs');

      const results = await this.mapWithConcurrency(
        links,
        DETAILS_CONCURRENCY,
        (link, index) => this.processExamDetailLink(context, link, logsDir, index)
      );

      return { success: true, data: results };
    } catch (e) {
      logger.error(`Error en getExamsDetails: ${e.message}`);
      throw e;
    } finally {
      if (browser) await browser.close();
    }
  }
}

module.exports = new ScraperOrchestrator();
