const { randomBytes, createHash, createCipheriv, createDecipheriv } = require('node:crypto');
const { PDFParse } = require('pdf-parse');
const config = require('../config/env');
const { BASE, ExalabError, ExalabHtml, normalizeRut, validDate, validateSource, changed, expired } = require('./exalabHtml');
const PREFIX = 'hhr-exalab://report/';
const MAX_PDF = 4 * 1024 * 1024;
const SESSION_TTL = 60 * 60_000;
const MAX_SESSION_AGE = 8 * SESSION_TTL;
const PAIR_TTL = 5 * 60_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const assertOwner = owner => {
  if (!/^[a-f0-9]{64}$/.test(owner || '')) throw new ExalabError('OWNER_REQUIRED', 'Sesión de operador requerida.', 401);
};
const readPdfText = async buffer => {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try { return (await parser.getText()).text; } finally { await parser.destroy(); }
};
const assertPdfPatient = (text, rut) => {
  const labels = [...String(text).matchAll(/\b(?:RUT(?:\s*\/\s*FIC)?|RUN)\s*:?\s*([\d.]+)(?:\s*-\s*([\dKk]))?\b/gi)];
  if (!labels.length || labels.some(match => match[2]
    ? normalizeRut(match[1] + '-' + match[2]) !== rut
    : match[1].replace(/\./g, '') !== rut.split('-')[0])) {
    throw new ExalabError('PATIENT_MISMATCH', 'El PDF no permite verificar el RUT solicitado. Revísalo en Exalab.');
  }
};
const normalizeSession = input => {
  if (!input || !Array.isArray(input.cookies) || input.cookies.length > 2 ||
      typeof input.userAgent !== 'string' || !input.userAgent || input.userAgent.length > 1024 || /[\r\n]/.test(input.userAgent)) throw expired();
  const cookies = new Map();
  for (const cookie of input.cookies) {
    const domain = typeof cookie.domain === 'string' ? cookie.domain.replace(/^\./, '') : '';
    if (!['PHPSESSID', 'cf_clearance'].includes(cookie.name) || cookies.has(cookie.name) ||
        !['exalab.saludoriente.cl', ...(cookie.name === 'cf_clearance' ? ['saludoriente.cl'] : [])].includes(domain) ||
        typeof cookie.value !== 'string' || !cookie.value || cookie.value.length > 8192 || /[\r\n;]/.test(cookie.value)) throw expired();
    cookies.set(cookie.name, cookie.value);
  }
  if (!cookies.has('PHPSESSID')) throw expired();
  return { cookies, userAgent: input.userAgent, id: randomBytes(24).toString('base64url'), created: Date.now(), touched: Date.now(), pending: Promise.resolve() };
};

class ExalabService {
  constructor({ fetchImpl = fetch, html = new ExalabHtml(), pdfText = readPdfText } = {}) {
    this.fetch = fetchImpl; this.html = html; this.pdfText = pdfText;
    this.sessions = new Map(); this.pairs = new Map(); this.bindings = new Map();
  }
  prune() {
    for (const [owner, session] of this.sessions) {
      if (Date.now() - session.touched >= SESSION_TTL || Date.now() - session.created >= MAX_SESSION_AGE) this.sessions.delete(owner);
    }
    for (const [pair, binding] of this.pairs) if (binding.expires <= Date.now()) this.pairs.delete(pair);
    for (const [owner, binding] of this.bindings) if (binding.expires <= Date.now()) this.bindings.delete(owner);
  }
  pair(owner) {
    assertOwner(owner); this.prune();
    for (const [key, value] of this.pairs) if (value.owner === owner) this.pairs.delete(key);
    if (!this.bindings.has(owner) && this.bindings.size >= 100) throw new ExalabError('BUSY', 'Intenta conectar Exalab más tarde.', 503);
    const pair = randomBytes(32).toString('base64url');
    const binding = { owner, expires: Date.now() + PAIR_TTL };
    this.pairs.set(digest(pair), binding); this.bindings.set(owner, binding);
    return { pair, expiresAt: Date.now() + PAIR_TTL };
  }
  async connect(pair, input) {
    this.prune();
    if (typeof pair !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pair)) throw expired();
    const binding = this.pairs.get(digest(pair));
    if (!binding) throw expired();
    this.pairs.delete(digest(pair));
    const session = normalizeSession(input);
    await this.preflight(session);
    // A newer pairing supersedes any connection attempt still in flight.
    if (this.bindings.get(binding.owner) !== binding || binding.expires <= Date.now()) throw expired();
    if (!this.sessions.has(binding.owner) && this.sessions.size >= 100) throw new ExalabError('BUSY', 'Intenta conectar Exalab más tarde.', 503);
    this.sessions.set(binding.owner, session);
    this.bindings.delete(binding.owner);
    return { connected: true };
  }
  disconnect(owner) {
    assertOwner(owner); this.sessions.delete(owner);
    this.bindings.delete(owner);
    for (const [key, value] of this.pairs) if (value.owner === owner) this.pairs.delete(key);
    return { connected: false };
  }
  session(owner) {
    assertOwner(owner); this.prune();
    const session = this.sessions.get(owner);
    if (!session) throw expired();
    session.touched = Date.now(); return session;
  }
  async withSession(owner, operation) {
    const session = this.session(owner);
    const run = session.pending.then(async () => {
      if (this.session(owner) !== session) throw expired();
      try {
        const result = await operation(session);
        if (this.sessions.get(owner) !== session) throw expired();
        return result;
      } catch (error) {
        if (error.code === 'SESSION_REQUIRED' && this.sessions.get(owner) === session) this.sessions.delete(owner);
        throw error;
      }
    });
    session.pending = run.catch(() => {});
    return run;
  }
  async request(session, path, data, pdf = false) {
    const url = new URL(path, BASE);
    if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith('/web_ssmo/') || url.username || url.password || url.hash) throw changed();
    let response;
    try {
      response = await this.fetch(url.href, {
        method: data ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(25_000),
        headers: {
          Cookie: [...session.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
          'User-Agent': session.userAgent, Referer: BASE + 'index.php',
          ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' } : {}),
        },
        body: data ? new URLSearchParams(data).toString() : undefined,
      });
      if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) throw expired();
      if (!response.ok) throw new ExalabError('SOURCE_UNAVAILABLE', 'Exalab no está disponible. Vuelve a intentar.');
      for (const cookie of response.headers.getSetCookie?.() || []) {
        const match = /^(PHPSESSID|cf_clearance)=([^;]*)/.exec(cookie);
        if (!match) continue;
        if (!match[2] || /[\r\n]/.test(match[2]) || match[2].length > 8192 || /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(cookie)) throw expired();
        session.cookies.set(match[1], match[2]);
      }
      const chunks = []; let size = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > (pdf ? MAX_PDF : 8 * 1024 * 1024)) { await reader.cancel(); throw changed(); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      const buffer = Buffer.concat(chunks);
      if (pdf) {
        if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) || !buffer.subarray(-2048).includes(Buffer.from('%%EOF'))) throw changed();
        return buffer;
      }
      const contentType = response.headers.get('content-type') || '';
      const html = buffer.toString(/charset=\s*(?:iso-8859-1|latin-1)/i.test(contentType) ? 'latin1' : 'utf8');
      if (/Iniciar sesi[oó]n con Clave[ÚU]nica|accounts\.claveunica\.gob\.cl\/accounts\/login/i.test(html)) throw expired();
      return html;
    } catch (error) {
      if (error instanceof ExalabError) throw error;
      throw new ExalabError('SOURCE_UNAVAILABLE', 'No se pudo conectar con Exalab por HTTPS. Comprueba la conexión del Mac mini.');
    }
  }
  async preflight(session) {
    const html = await this.request(session, 'index.php');
    if (!/\bid=['"]rut['"]/.test(html)) throw expired();
  }
  async status(owner) {
    return this.withSession(owner, async session => { await this.preflight(session); return { connected: true }; });
  }
  seal(payload) {
    const iv = randomBytes(12);
    const key = createHash('sha256').update('exalab:' + config.apiToken).digest();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
  }
  readLink(link, owner, session) {
    try {
      if (typeof link !== 'string' || !link.startsWith(PREFIX) || link.length > 8192) throw changed();
      const bytes = Buffer.from(link.slice(PREFIX.length), 'base64url');
      const key = createHash('sha256').update('exalab:' + config.apiToken).digest();
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
      if (payload.owner !== owner || payload.session !== session.id || !Number.isFinite(payload.expires) || payload.expires <= Date.now() || !/^\d+$/.test(payload.id)) throw changed();
      normalizeRut(payload.rut); validateSource(payload.source, payload.id); return payload;
    } catch { throw new ExalabError('REPORT_EXPIRED', 'El informe no pertenece a una búsqueda vigente. Repite la consulta.', 409); }
  }
  async search(owner, { rut, from, to } = {}) {
    rut = normalizeRut(rut);
    if (!validDate(from) || !validDate(to) || from > to) throw new ExalabError('INVALID_RANGE', 'Selecciona un período válido de Exalab.', 400);
    return this.withSession(owner, async session => {
      await this.preflight(session);
      const all = await this.html.list(await this.request(session, 'controlador/consulta.php', { rut }), rut);
      return all.filter(exam => exam.date >= from && exam.date <= to).sort((a, b) =>
        (b.date + b.time).localeCompare(a.date + a.time) || b.id.localeCompare(a.id)).map(exam => {
        const { source, ...item } = exam;
        return { ...item, link: this.seal({ source, id: exam.id, rut, owner, session: session.id, expires: Date.now() + 30 * 60_000 }) };
      });
    });
  }
  async pdf(owner, link) {
    return this.withSession(owner, async session => {
      const exam = this.readLink(link, owner, session);
      await this.preflight(session);
      const html = await this.request(session, 'controlador/ventana.php', { url: exam.source, id: exam.id, rut: exam.rut.split('-')[0] });
      const bytes = await this.request(session, await this.html.pdfUrl(html), undefined, true);
      assertPdfPatient(await this.pdfText(bytes), exam.rut);
      return bytes;
    });
  }
  async close() { this.sessions.clear(); this.pairs.clear(); this.bindings.clear(); await this.html.close?.(); }
}
module.exports = { ExalabService, assertPdfPatient, normalizeSession, MAX_PDF };
