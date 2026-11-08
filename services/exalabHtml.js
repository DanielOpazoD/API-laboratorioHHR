const { chromium } = require('playwright');

const BASE = 'https://exalab.saludoriente.cl/web_ssmo/';
class ExalabError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}
const changed = () => new ExalabError('SOURCE_CHANGED', 'No se pudo verificar la respuesta de Exalab. Abre el visor original.');
const expired = () => new ExalabError('SESSION_REQUIRED', 'Conecta o renueva tu sesión personal de Exalab desde Chrome del Mac mini.', 409);
const normalizeRut = value => {
  const rut = typeof value === 'string' ? value.trim().replace(/\./g, '').toUpperCase() : '';
  const match = /^(\d{7,8})-([0-9K])$/.exec(rut);
  if (!match) throw new ExalabError('INVALID_RUT', 'Exalab requiere un RUT completo con dígito verificador.', 400);
  let sum = 0;
  [...match[1]].reverse().forEach((digit, i) => { sum += Number(digit) * (2 + i % 6); });
  const check = 11 - sum % 11;
  if (match[2] !== (check === 11 ? '0' : check === 10 ? 'K' : String(check))) {
    throw new ExalabError('INVALID_RUT', 'El dígito verificador del RUT no coincide.', 400);
  }
  return rut;
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().startsWith(value);
const validateSource = (value, folio) => {
  let url;
  try { url = new URL(value); } catch { throw changed(); }
  const octets = url.hostname.split('.').map(Number);
  const internal = /^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname) &&
    octets.every(n => n <= 255) && url.pathname.toLowerCase() === '/syslab/detalleexamenes.php';
  const fixed = new Set([
    'localhost/web_ssmo/proactive/getexamen.php',
    'localhost/web_ssmo/controlador/detalleexamenesexalab.php',
    'syslab.calvomackenna.cl/detalleexameneshlcm.php',
  ]);
  if ((!internal && !fixed.has(url.hostname + url.pathname.toLowerCase())) ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash ||
      (!internal && url.port) || [...url.searchParams.keys()].length !== 1 || url.searchParams.get('id') !== folio) throw changed();
  // A source is only a parameter returned to Exalab, never a network destination.
  return value;
};

class ExalabHtml {
  async document(html, operation) {
    this.browserPromise ||= chromium.launch({ headless: true });
    const browser = await this.browserPromise;
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => route.abort());
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      return await operation(page);
    } finally { await context.close(); }
  }
  async list(html, rut) {
    if (!html.trim()) return [];
    const model = await this.document(html, page => page.evaluate(() => ({
      text: document.body.innerText.replace(/\s+/g, ' ').trim(),
      rows: [...document.querySelectorAll('tr')].map(row => ({
        onclick: row.getAttribute('onclick') || '',
        cells: [...row.querySelectorAll(':scope > td, :scope > th')].map(cell => cell.textContent.replace(/\s+/g, ' ').trim()),
      })),
    })));
    const results = new Map();
    for (const row of model.rows) {
      if (!row.onclick) continue;
      const match = /^\s*ver_ficha_param2\(\s*(['"])([^'"]+)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*;?\s*$/.exec(row.onclick);
      if (!match || row.cells.length < 8) throw changed();
      const [, , source, id, body] = match;
      if (body !== rut.split('-')[0] || normalizeRut(row.cells[4]) !== rut || row.cells[1] !== id) throw changed();
      const stamp = /^(\d{2})-(\d{2})-(\d{4})$/.exec(row.cells[2]);
      const date = stamp && `${stamp[3]}-${stamp[2]}-${stamp[1]}`;
      if (!validDate(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(row.cells[3])) throw changed();
      validateSource(source, id);
      results.set(source + ':' + id, {
        id, rut, date, time: row.cells[3], patientName: row.cells[5],
        laboratory: row.cells[6], exams: row.cells[7], source,
      });
    }
    if (!results.size) {
      const header = ['Num', 'N Examen', 'Fecha', 'Hora', 'Rut', 'Nombre', 'Laboratorio/Procedencia', 'Examenes'];
      if (model.rows.length !== 1 || JSON.stringify(model.rows[0].cells) !== JSON.stringify(header) ||
          model.text !== 'Folios Asociados ' + header.join(' ')) throw changed();
    }
    return [...results.values()];
  }
  async pdfUrl(html) {
    const paths = await this.document(html, page => page.evaluate(() =>
      [...document.querySelectorAll('object[data], iframe[src], embed[src]')].map(el => el.getAttribute(el.tagName === 'OBJECT' ? 'data' : 'src'))));
    if (paths.length !== 1) throw changed();
    const url = new URL(paths[0], BASE);
    if (url.origin !== new URL(BASE).origin || url.username || url.password || url.search || url.hash ||
        !/^\/web_ssmo\/pdf\/[A-Za-z0-9_-]+\.pdf$/.test(url.pathname)) throw changed();
    return url.href;
  }
  async close() { if (this.browserPromise) await (await this.browserPromise).close(); this.browserPromise = null; }
}
module.exports = { BASE, ExalabError, ExalabHtml, normalizeRut, validDate, validateSource, changed, expired };
