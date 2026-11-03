const browserManager = require('./browserManager');
const { parseReportText } = require('../utils/reportParser');
const logger = require('../utils/logger');
const config = require('../config/env');
const { PDFParse } = require('pdf-parse');
const { issueReportLink, readReportLink, isAllowedResource, assertReportPatient } = require('./reportAccess');

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

  extractExamsFromDocument() {
    const rows = Array.from(document.querySelectorAll('table.narrow tr'));
    return rows.map(row => {
      const tds = row.querySelectorAll('td');
      if (tds.length < 6) return null;
      const aTag = tds[0].querySelector('a');
      const href = aTag ? aTag.getAttribute('href') : '';
      const id = aTag ? aTag.innerText.trim() : tds[0].innerText.trim();
      if (!id || !/^\d+$/.test(id)) return null;
      if (href && !href.includes('detalleexamenes.php')) return null;

      const rawDate = tds[1].innerHTML;
      const dateParts = rawDate.split('<br>');
      const date = dateParts[0] ? dateParts[0].trim() : tds[1].innerText.trim();
      const time = dateParts[1] ? dateParts[1].replace(/<[^>]+>/g, '').trim() : '';
      const patientName = tds[3].innerText.trim();
      const origin = tds[4].innerText.trim();
      const examsTags = Array.from(tds[5].querySelectorAll('.mitabla tr td'));
      const examNames = examsTags
        .map(td => td.innerText.replace(/\(V\)|\(P\)/g, '').trim())
        .filter(e => e !== '');
      const link = href ? new URL(href.trim(), document.baseURI || window.location.href).href : null;
      const rutBody = (tds[2].innerText.match(/\d[\d.]*/) || [''])[0].replace(/\D/g, '');
      return { id, link, rutBody, date, time, patientName, origin, exams: examNames };
    }).filter(Boolean);
  }

  async getExamsList(rut) {
    let browser, context, page;
    try {
      browser = await browserManager.initBrowser();
      context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await browserManager.configureContext(context);
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
      if (!/^\d{5,9}$/.test(cleanRut)) throw new Error('El RUN de búsqueda no es válido.');
      const rutInput = page.locator('input[name="rut"], input[type="text"]').first();
      await rutInput.waitFor({ state: 'visible', timeout: 10000 });
      await rutInput.fill(cleanRut);
      
      const acceptBtn = page.locator('input[value*="Aceptar"], button:has-text("Aceptar"), input[value*="Buscar"], button:has-text("Buscar"), input[type="submit"]').first();
      await acceptBtn.click();
      await page.waitForLoadState('networkidle');

      if (!(await page.locator('table.narrow').count())) throw new Error('Syslab no confirmó una respuesta de búsqueda válida.');
      const exams = await page.evaluate(this.extractExamsFromDocument);

      if (exams.some(exam => exam.rutBody !== cleanRut)) throw new Error('Syslab devolvió órdenes de otro paciente.');
      return { success: true, data: exams.map(({ rutBody, ...exam }) => ({ ...exam, link: issueReportLink(exam.link, cleanRut) })) };
    } catch (e) {
      logger.warn('No se pudo completar la búsqueda de laboratorio.');
      throw e;
    } finally {
      if (browser) await browser.close();
    }
  }

  async readValidatedPdf(context, reference) {
    const { link, rutBody } = readReportLink(reference);
    let url = link;
    let bytes;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!isAllowedResource(url)) throw new Error('Ruta de informe no permitida.');
      const response = await context.request.get(url, { maxRedirects: 0, timeout: 20_000 });
      try {
        if (response.status() >= 300 && response.status() < 400) {
          url = new URL(response.headers().location, url).href;
          continue;
        }
        if (!response.ok()) throw new Error('Syslab no pudo entregar el informe.');
        const body = await response.body();
        if (!body.length || body.length > 4 * 1024 * 1024) throw new Error('El informe está vacío o supera 4 MB.');
        if (body.subarray(0, 4).toString() === '%PDF') { bytes = body; break; }
        const page = await context.newPage();
        try {
          const nested = await page.evaluate(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            if (doc.querySelector('input[type="password"]')) return null;
            const element = doc.querySelector('iframe[src], embed[src], object[data], a[href*=".pdf"]');
            return element && (element.getAttribute('src') || element.getAttribute('data') || element.getAttribute('href'));
          }, body.toString('utf8'));
          if (!nested) throw new Error('Syslab no entregó un PDF verificable. Puede requerir iniciar sesión.');
          url = new URL(nested, url).href;
        } finally { await page.close(); }
      } finally { await response.dispose(); }
    }
    if (!bytes) throw new Error('No se pudo obtener el PDF original de Syslab.');
    const parser = new PDFParse({ data: bytes });
    let text;
    try { text = (await parser.getText()).text; }
    finally { await parser.destroy(); }
    assertReportPatient(text, rutBody);
    return { bytes, text };
  }

  async withAuthenticatedContext(operation) {
    const browser = await browserManager.initBrowser();
    try {
      const context = await browser.newContext();
      await browserManager.configureContext(context);
      const page = await context.newPage();
      await page.goto(config.syslab.baseUrl, { waitUntil: 'networkidle' });
      await browserManager.login(page);
      await page.close();
      return await operation(context);
    } finally { await browser.close(); }
  }

  async getExamPdf(reference) {
    readReportLink(reference);
    return this.withAuthenticatedContext(async context => (await this.readValidatedPdf(context, reference)).bytes);
  }

  async getExamsDetails(links) {
    if (!Array.isArray(links) || !links.length || links.length > 3) throw new Error('Se admiten entre 1 y 3 informes por solicitud.');
    const references = links.map(readReportLink);
    if (new Set(references.map(ref => ref.rutBody)).size !== 1 || new Set(links).size !== links.length) {
      throw new Error('La selección mezcla pacientes o informes repetidos.');
    }
    return this.withAuthenticatedContext(async context => {
      const data = await this.mapWithConcurrency(links, DETAILS_CONCURRENCY, async url => {
        const { text } = await this.readValidatedPdf(context, url);
        return { url, findings: parseReportText(text) };
      });
      return { success: true, data };
    });
  }
}

module.exports = new ScraperOrchestrator();
