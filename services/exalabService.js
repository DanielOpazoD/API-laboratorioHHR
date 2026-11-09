const { randomBytes, createHash, createCipheriv, createDecipheriv } = require('node:crypto');
const fs = require('node:fs');
const nodePath = require('node:path');
const { PDFParse } = require('pdf-parse');
const config = require('../config/env');
const { BASE, ExalabError, ExalabHtml, exalabUserName, normalizeRut, validDate, validateSource, changed, expired } = require('./exalabHtml');
const PREFIX = 'hhr-exalab://report/';
const MAX_PDF = 4 * 1024 * 1024;
const SESSION_TTL = 60 * 60_000;
// A clinical shift. Keep-alive refreshes Exalab's own idle timeout, never this absolute limit.
const MAX_SESSION_AGE = 12 * SESSION_TTL;
const KEEP_ALIVE_MS = 10 * 60_000;
const DEFAULT_STATE_FILE = nodePath.join(process.env.SYSLAB_STATE_DIR || nodePath.join(__dirname, '../state'), 'exalab-sessions.bin');
const stateKey = () => createHash('sha256').update('exalab-sessions:' + config.apiToken).digest();
const PAIR_TTL = 5 * 60_000;
const digest = value => createHash('sha256').update(value).digest('hex');
/** Short, non-reversible name of the HHR account a session belongs to (shared with the extension). */
const ownerFingerprint = owner => digest('exalab-owner:' + owner).slice(0, 16);
/** Short fingerprint of the Exalab user (normalized display name); the name itself is never returned or logged. */
const exalabUserFingerprint = name => name
  ? digest('exalab-user:' + name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()).slice(0, 16)
  : null;
const assertOwner = owner => {
  if (!/^[a-f0-9]{64}$/.test(owner || '')) throw new ExalabError('OWNER_REQUIRED', 'Sesión de operador requerida.', 401);
};
const readPdfText = async buffer => {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try { return (await parser.getText()).text; } finally { await parser.destroy(); }
};
// Hospital del Salvador reports print «IDENTIFICACION : 6.321.880-4», with no RUT label, and the
// extracted text may not keep the value next to its label. Fail closed: every RUT-shaped token in the
// PDF, and every number next to an identity label, must be the patient's (check digit included).
const RUT_TOKEN = /(?<![\d.])(\d{1,2}(?:\.?\d{3}){2})\s*-\s*([\dKk])/g;
const IDENTITY_LABEL = /\b(?:RUT(?:\s*\/\s*FIC)?|RUN|IDENTIFICACI[OÓ]N)\s*:?\s*(\d[\d.]*)(?:\s*-\s*([\dKk]))?/gi;
const assertPdfPatient = (text, rut) => {
  const [number, check] = rut.split('-');
  const read = regex => [...String(text).matchAll(regex)]
    .map(match => ({ number: match[1].replace(/\./g, ''), check: match[2]?.toUpperCase() }));
  const found = [...read(RUT_TOKEN), ...read(IDENTITY_LABEL)];
  if (!found.length || found.some(id => id.number !== number || (id.check && id.check !== check))) {
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
  /** `stateFile` keeps connected sessions sealed across restarts; `keepAliveMs` refreshes them in Exalab. */
  constructor({ fetchImpl = fetch, html = new ExalabHtml(), pdfText = readPdfText, stateFile = null, keepAliveMs = 0 } = {}) {
    this.fetch = fetchImpl; this.html = html; this.pdfText = pdfText;
    this.sessions = new Map(); this.pairs = new Map(); this.bindings = new Map();
    this.stateFile = stateFile; this.keepAliveMs = keepAliveMs;
    this.restore();
    if (keepAliveMs > 0) {
      this.keepAliveTimer = setInterval(() => { this.keepAlive().catch(() => {}); }, keepAliveMs);
      this.keepAliveTimer.unref?.();
    }
  }
  /** Sealed with a key derived from the bridge token; only owner hashes, cookies and timestamps. */
  persist() {
    if (!this.stateFile) return;
    try {
      if (!this.sessions.size) { fs.rmSync(this.stateFile, { force: true }); return; }
      const payload = JSON.stringify([...this.sessions].map(([owner, session]) => ({
        owner, id: session.id, cookies: [...session.cookies], userAgent: session.userAgent,
        created: session.created, touched: session.touched,
      })));
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', stateKey(), iv);
      const bytes = Buffer.concat([cipher.update(payload), cipher.final()]);
      fs.mkdirSync(nodePath.dirname(this.stateFile), { recursive: true, mode: 0o700 });
      const temporary = `${this.stateFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
      fs.writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), bytes]), { mode: 0o600 });
      fs.renameSync(temporary, this.stateFile);
    } catch {
      console.warn('[exalab] No se pudieron guardar las sesiones conectadas; siguen activas en memoria.');
    }
  }
  restore() {
    if (!this.stateFile || !fs.existsSync(this.stateFile)) return;
    try {
      const bytes = fs.readFileSync(this.stateFile);
      const decipher = createDecipheriv('aes-256-gcm', stateKey(), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const stored = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
      if (!Array.isArray(stored)) throw new Error('invalid');
      for (const entry of stored) {
        assertOwner(entry?.owner);
        if (!Array.isArray(entry.cookies) || !Number.isFinite(entry.created) || !Number.isFinite(entry.touched) ||
            typeof entry.id !== 'string') throw new Error('invalid');
        const session = normalizeSession({
          userAgent: entry.userAgent,
          cookies: entry.cookies.map(([name, value]) => ({ name, value, domain: 'exalab.saludoriente.cl' })),
        });
        Object.assign(session, { id: entry.id, created: entry.created, touched: entry.touched });
        this.sessions.set(entry.owner, session);
      }
    } catch {
      this.sessions.clear();
      console.warn('[exalab] Sesiones guardadas ilegibles; el puente empieza sin sesiones conectadas.');
    }
    this.prune();
  }
  /** One serialized preflight per idle session: refreshes Exalab's idle timeout, not the bridge's age limit. */
  async keepAlive(now = Date.now()) {
    this.prune();
    for (const [owner, session] of [...this.sessions]) {
      if (now - session.touched < this.keepAliveMs) continue;
      // SESSION_REQUIRED drops the session inside withSession; a network failure keeps it.
      await this.withSession(owner, active => this.preflight(active)).catch(() => {});
    }
    this.persist();
  }
  prune() {
    let removed = false;
    for (const [owner, session] of this.sessions) {
      if (Date.now() - session.touched >= SESSION_TTL || Date.now() - session.created >= MAX_SESSION_AGE) {
        this.sessions.delete(owner); removed = true;
      }
    }
    if (removed) this.persist();
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
  async connect(pair, input, expectedOwner, expectedExalabUser) {
    this.prune();
    if (typeof pair !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pair)) throw expired();
    const binding = this.pairs.get(digest(pair));
    if (!binding) throw expired();
    this.pairs.delete(digest(pair));
    // A silent reconnection names the HHR account that consented; a pair minted for another account
    // (e.g. injected into a compromised page) is consumed and never receives this session.
    if (expectedOwner !== undefined && expectedOwner !== ownerFingerprint(binding.owner)) {
      throw new ExalabError('OWNER_MISMATCH', 'Esta sesión de Exalab se autorizó para otra cuenta HHR. Conéctala de nuevo desde HHR.', 403);
    }
    const session = normalizeSession(input);
    const exalabUser = exalabUserFingerprint(exalabUserName(await this.preflight(session)));
    // A silent reconnection also names the Exalab user who consented: on a shared PC, another person's
    // Exalab login must not be bound to this HHR account. An unrecognizable page fails closed.
    if (expectedExalabUser !== undefined && (!exalabUser || expectedExalabUser !== exalabUser)) {
      throw new ExalabError('EXALAB_USER_MISMATCH', 'La sesión de Exalab abierta es de otra persona. Conéctala de nuevo desde HHR.', 403);
    }
    // A newer pairing supersedes any connection attempt still in flight.
    if (this.bindings.get(binding.owner) !== binding || binding.expires <= Date.now()) throw expired();
    if (!this.sessions.has(binding.owner) && this.sessions.size >= 100) throw new ExalabError('BUSY', 'Intenta conectar Exalab más tarde.', 503);
    this.sessions.set(binding.owner, session);
    this.bindings.delete(binding.owner);
    this.persist();
    return { connected: true, expiresAt: session.created + MAX_SESSION_AGE, owner: ownerFingerprint(binding.owner), ...(exalabUser ? { exalabUser } : {}) };
  }
  disconnect(owner) {
    assertOwner(owner);
    if (this.sessions.delete(owner)) this.persist();
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
        if (error.code === 'SESSION_REQUIRED' && this.sessions.get(owner) === session) {
          this.sessions.delete(owner); session.dirty = true;
        }
        throw error;
      } finally {
        // Exalab may rotate its cookies; a restart must resume with the current ones.
        if (session.dirty) { session.dirty = false; this.persist(); }
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
        if (session.cookies.get(match[1]) !== match[2]) { session.cookies.set(match[1], match[2]); session.dirty = true; }
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
    return html;
  }
  async status(owner) {
    return this.withSession(owner, async session => {
      await this.preflight(session);
      return { connected: true, expiresAt: session.created + MAX_SESSION_AGE };
    });
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
  async close() { clearInterval(this.keepAliveTimer); this.sessions.clear(); this.pairs.clear(); this.bindings.clear(); await this.html.close?.(); }
}
module.exports = { ExalabService, ownerFingerprint, exalabUserFingerprint, assertPdfPatient, normalizeSession, MAX_PDF, MAX_SESSION_AGE, KEEP_ALIVE_MS, DEFAULT_STATE_FILE };
