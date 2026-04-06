const browserManager = require('./browserManager');
const { parseReportText } = require('../utils/reportParser');
const logger = require('../utils/logger');
const config = require('../config/env');
const pdf = require('pdf-parse');
const path = require('path');
const fs = require('fs');

class ScraperOrchestrator {
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

      logger.info(`Buscando RUT: ${rut}`);
      const rutInput = page.locator('input[name="rut"], input[type="text"]').first();
      await rutInput.waitFor({ state: 'visible', timeout: 10000 });
      await rutInput.fill(rut);
      
      const acceptBtn = page.locator('input[value*="Aceptar"], button:has-text("Aceptar")').first();
      await acceptBtn.click();
      await page.waitForLoadState('networkidle');

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
          const baseUrl = window.location.href.split('buscarexamenesrut.php')[0];
          return { id, link: href ? `${baseUrl}${href.trim()}` : null, date, time, patientName, origin, exams: examNames };
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

  async getExamsDetails(links) {
    let browser, context, mainPage;
    try {
      browser = await browserManager.initBrowser();
      context = await browser.newContext({ acceptDownloads: true });
      mainPage = await context.newPage();
      
      await mainPage.goto(config.syslab.baseUrl, { waitUntil: 'networkidle' });
      await browserManager.login(mainPage);
      await mainPage.close();

      const results = [];
      const logsDir = path.join(__dirname, '../logs');

      for (const link of links) {
        logger.info(`Procesando link: ${link}`);
        const page = await context.newPage();
        let textContent = "";

        try {
          const [ response ] = await Promise.all([
            page.waitForResponse(res => res.url().includes('detalleexamenes.php'), { timeout: 15000 }).catch(() => null),
            page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
            page.goto(link, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null)
          ]);

          if (response && response.headers()['content-type']?.includes('pdf')) {
            const buffer = await response.buffer();
            const data = await pdf(buffer);
            textContent = data.text;
          } else {
            textContent = await page.innerText('body').catch(() => "");
          }

          fs.writeFileSync(path.join(logsDir, `raw_extract_${Date.now()}.txt`), textContent);
          const findings = parseReportText(textContent);
          results.push({ url: link, findings });
        } catch (e) {
          logger.error(`Fallo en details ${link}: ${e.message}`);
          results.push({ url: link, findings: [], error: e.message });
        } finally {
          await page.close();
        }
      }
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
