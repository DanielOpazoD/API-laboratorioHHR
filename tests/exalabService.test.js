const config = require('../config/env');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ExalabService, ownerFingerprint, assertPdfPatient, MAX_SESSION_AGE } = require('../services/exalabService');
const { ExalabHtml } = require('../services/exalabHtml');
const owner = 'a'.repeat(64), other = 'b'.repeat(64);
const rut = '12345678-5';
const session = { cookies: [{ name: 'PHPSESSID', value: 'synthetic-session', domain: 'exalab.saludoriente.cl' }], userAgent: 'Synthetic Browser' };
const header = '<h3>Folios Asociados</h3><table><tr>' + ['Num', 'N Examen', 'Fecha', 'Hora', 'Rut', 'Nombre', 'Laboratorio/Procedencia', 'Examenes'].map(value => `<th>${value}</th>`).join('') + '</tr>';
const row = (source = 'http://localhost/web_ssmo/proactive/getexamen.php?id=123', identity = rut) =>
  `<tr onclick="ver_ficha_param2('${source}',123,12345678)"><td>1</td><td>123</td><td>08-11-2026</td><td>12:34:56</td><td>${identity}</td><td>PACIENTE SINTETICO</td><td>CENTRO SINTETICO</td><td>GLUCOSA</td></tr>`;
const pdf = identity => {
  const stream = `BT /F1 12 Tf 72 720 Td (RUT: ${identity}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((value, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  return Buffer.from(content + 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
};
let service, transport, list, original;
beforeEach(() => {
  config.apiToken = 'synthetic'.repeat(8); list = header + row() + '</table>'; original = pdf(rut);
  transport = jest.fn(async url => {
    if (!url.startsWith('https://exalab.saludoriente.cl/web_ssmo/')) throw new Error('forbidden destination');
    if (url.endsWith('index.php')) return new Response('<h1>Consulta Exámenes</h1><input id="rut">');
    if (url.endsWith('consulta.php')) return new Response(list);
    if (url.endsWith('ventana.php')) return new Response('<object data="pdf/synthetic.pdf"></object>');
    if (url.endsWith('/pdf/synthetic.pdf')) return new Response(original, { headers: { 'Content-Type': 'application/pdf' } });
    return new Response('', { status: 404 });
  });
  service = new ExalabService({ fetchImpl: transport });
});
afterEach(async () => { await service.close(); jest.restoreAllMocks(); });
const connect = async (who = owner) => service.connect(service.pair(who).pair, session);
const search = () => service.search(owner, { rut, from: '2026-11-01', to: '2026-11-08' });

test('returns source-labelled exams and verifies an original PDF without visiting internal source URLs', async () => {
  const pair = service.pair(owner).pair;
  await service.connect(pair, session);
  expect(transport.mock.calls[0][1].headers).toMatchObject({ 'User-Agent': 'Synthetic Browser', Cookie: 'PHPSESSID=synthetic-session' });
  expect(transport.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  await expect(service.connect(pair, session)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
  const exams = await search();
  expect(exams).toMatchObject([{ id: '123', rut, laboratory: 'CENTRO SINTETICO', date: '2026-11-08', time: '12:34:56' }]);
  expect(JSON.stringify(exams)).not.toContain('localhost');
  expect(await service.pdf(owner, exams[0].link)).toEqual(original);
  expect(transport.mock.calls.every(([url]) => url.startsWith('https://exalab.saludoriente.cl/'))).toBe(true);
  expect(transport.mock.calls.find(([url]) => url.endsWith('ventana.php'))[1].body).toContain('url=http%3A%2F%2Flocalhost');
  original = pdf('11111111-1');
  await expect(service.pdf(owner, exams[0].link)).rejects.toMatchObject({ code: 'PATIENT_MISMATCH' });
}, 45_000);

test('empty authenticated tables are absence; unknown HTML and mismatched identities are failures', async () => {
  await connect(); list = header + '</table>'; await expect(search()).resolves.toEqual([]);
  list = '<h1>Error inesperado</h1>'; await expect(search()).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  list = header + row(undefined, '11111111-1') + '</table>'; await expect(search()).rejects.toBeDefined();
  list = header + row('http://127.0.0.1/admin?id=123') + '</table>'; await expect(search()).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
}, 45_000);

test('reports are bound to their operator, current session and expiry', async () => {
  await connect(); await connect(other); const [exam] = await search();
  await expect(service.pdf(other, exam.link)).rejects.toMatchObject({ code: 'REPORT_EXPIRED' });
  await expect(service.pdf(owner, exam.link.slice(0, -10) + 'AAAAAAAAAA')).rejects.toMatchObject({ code: 'REPORT_EXPIRED' });
  await connect(); await expect(service.pdf(owner, exam.link)).rejects.toMatchObject({ code: 'REPORT_EXPIRED' });
  service.disconnect(owner); await expect(search()).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
}, 45_000);

test('expired authentication is never a successful empty search and errors contain no raw credentials', async () => {
  await connect(); transport.mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: 'https://accounts.claveunica.gob.cl/' } }));
  await expect(search()).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
  await expect(service.status(owner)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
  transport.mockRejectedValueOnce(new Error('synthetic-session password secret'));
  await expect(connect()).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', message: expect.not.stringContaining('password') });
});

test('a silent reconnection binds the session only to the HHR account that consented', async () => {
  const connected = await service.connect(service.pair(owner).pair, session, ownerFingerprint(owner));
  expect(connected).toMatchObject({ connected: true, owner: ownerFingerprint(owner) });
  expect(ownerFingerprint(owner)).toMatch(/^[a-f0-9]{16}$/);
  expect(ownerFingerprint(owner)).not.toBe(ownerFingerprint(other));
  // A pair minted for another account (e.g. injected into a compromised page) is refused and consumed.
  const foreign = service.pair(other).pair;
  transport.mockClear();
  await expect(service.connect(foreign, session, ownerFingerprint(owner))).rejects.toMatchObject({ code: 'OWNER_MISMATCH', status: 403 });
  expect(transport).not.toHaveBeenCalled();
  await expect(service.status(other)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
  await expect(service.connect(foreign, session)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
  // The manual consent path, without expectedOwner, keeps working and reports the fingerprint.
  await expect(service.connect(service.pair(other).pair, session)).resolves.toMatchObject({ owner: ownerFingerprint(other) });
});

test('disconnect and newer pairings invalidate an in-flight connection', async () => {
  let release;
  transport.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = connect(); service.disconnect(owner);
  release(new Response('<input id="rut">'));
  await expect(pending).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
  transport.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const older = connect(); const newest = service.pair(owner).pair;
  await service.connect(newest, session);
  release(new Response('<input id="rut">'));
  await expect(older).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
  await expect(service.status(owner)).resolves.toMatchObject({ connected: true, expiresAt: expect.any(Number) });
});

test('invalid RUTs, ranges, cookie domains and unverifiable PDFs fail before clinical access', async () => {
  await expect(service.search(owner, { rut: 'P12345678-5', from: '2026-11-01', to: '2026-11-08' })).rejects.toMatchObject({ code: 'INVALID_RUT' });
  await expect(service.search(owner, { rut, from: '2026-02-30', to: '2026-11-08' })).rejects.toMatchObject({ code: 'INVALID_RANGE' });
  await expect(service.connect(service.pair(owner).pair, { ...session, cookies: [{ name: 'PHPSESSID', value: 'x', domain: 'other.test' }] })).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
  expect(transport).not.toHaveBeenCalled();
  expect(() => assertPdfPatient('RUT: 12.345.678-5\nRUT: 11.111.111-1', rut)).toThrow();
  expect(() => assertPdfPatient('Sin identidad', rut)).toThrow();
  expect(() => assertPdfPatient('Rut/Fic: 12.345.678', rut)).not.toThrow();
  // Hospital del Salvador layout: the identity label carries no «RUT» and its value may be extracted apart.
  expect(() => assertPdfPatient('PACIENTE :\nIDENTIFICACION :\nEDAD :\nPACIENTE SINTETICO\n12.345.678-5\n79 años', rut)).not.toThrow();
  expect(() => assertPdfPatient('IDENTIFICACION : 11.111.111-1', rut)).toThrow();
  expect(() => assertPdfPatient('IDENTIFICACION : 12.345.678-5\nIDENTIFICACION : 11.111.111-1', rut)).toThrow();
  expect(() => assertPdfPatient('IDENTIFICACION : 12.345.678-5\nRut/Fic: 11.111.111', rut)).toThrow();
  // Fail closed: an invalid check digit, letters glued to a RUT or another number by an identity label.
  expect(() => assertPdfPatient('IDENTIFICACION : 12.345.678-5\nRUT: 11.111.111-2', rut)).toThrow();
  expect(() => assertPdfPatient('IDENTIFICACION : 12.345.678-5\n11.111.111-1ABC', rut)).toThrow();
  expect(() => assertPdfPatient('12.345.678-5\nIDENTIFICACION : 11111111', rut)).toThrow();
  expect(() => assertPdfPatient('IDENTIFICACION : 12.345.678-0', rut)).toThrow();
});

describe('connected sessions survive restarts and stay alive', () => {
  let directory, stateFile;
  const restart = (options = {}) => new ExalabService({ fetchImpl: transport, stateFile, ...options });
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'exalab-state-'));
    stateFile = path.join(directory, 'exalab-sessions.bin');
  });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); jest.useRealTimers(); });

  test('a restarted bridge resumes the sealed session; the file never holds plaintext cookies', async () => {
    const first = restart();
    const connected = await first.connect(first.pair(owner).pair, session);
    expect(connected).toMatchObject({ connected: true });
    expect(connected.expiresAt - Date.now()).toBeLessThanOrEqual(MAX_SESSION_AGE);
    expect((fs.statSync(stateFile).mode & 0o777).toString(8)).toBe('600');
    const sealed = fs.readFileSync(stateFile);
    expect(sealed.includes(Buffer.from('synthetic-session'))).toBe(false);
    expect(sealed.includes(Buffer.from('Synthetic Browser'))).toBe(false);
    await first.close();
    const second = restart();
    await expect(second.status(owner)).resolves.toMatchObject({ connected: true });
    expect(transport.mock.calls.at(-1)[1].headers).toMatchObject({ Cookie: 'PHPSESSID=synthetic-session', 'User-Agent': 'Synthetic Browser' });
    await second.close();
  });

  test('a corrupt or foreign file starts empty without crashing', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(stateFile, 'not a sealed file');
    const restored = restart();
    await expect(restored.status(owner)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(console.warn.mock.calls[0][0])).not.toContain('not a sealed file');
    await restored.close();
  });

  test('disconnecting removes the session from disk', async () => {
    const first = restart();
    await first.connect(first.pair(owner).pair, session);
    expect(fs.existsSync(stateFile)).toBe(true);
    first.disconnect(owner);
    expect(fs.existsSync(stateFile)).toBe(false);
    await first.close();
    const second = restart();
    await expect(second.status(owner)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    await second.close();
  });

  test('keep-alive drops a session Exalab ended and keeps one behind a network failure', async () => {
    const live = restart({ keepAliveMs: 10 * 60_000 });
    await live.connect(live.pair(owner).pair, session);
    await live.connect(live.pair(other).pair, session);
    transport.mockImplementation(async (url, init) => {
      if (init.headers.Cookie === 'PHPSESSID=synthetic-session' && url.endsWith('index.php')) throw new Error('network down');
      return new Response('');
    });
    await live.keepAlive(Date.now() + 10 * 60_000);
    expect(live.sessions.has(owner)).toBe(true);
    expect(live.sessions.has(other)).toBe(true);
    // Same cookie for both owners in this synthetic setup: make only one of them end.
    live.sessions.get(other).cookies.set('PHPSESSID', 'ended-session');
    transport.mockImplementation(async (url, init) =>
      init.headers.Cookie === 'PHPSESSID=ended-session' ? new Response('<h1>Iniciar sesión con ClaveÚnica</h1>') : new Response('<input id="rut">'));
    await live.keepAlive(Date.now() + 10 * 60_000);
    expect(live.sessions.has(other)).toBe(false);
    expect(live.sessions.has(owner)).toBe(true);
    await live.close();
    const restored = restart();
    expect(restored.sessions.has(other)).toBe(false);
    expect(restored.sessions.has(owner)).toBe(true);
    await restored.close();
  });

  test('a session Exalab ended during a request is gone after a restart', async () => {
    const first = restart();
    await first.connect(first.pair(owner).pair, session);
    transport.mockImplementation(async () => new Response('<h1>Iniciar sesión con ClaveÚnica</h1>'));
    await expect(first.status(owner)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    await first.close();
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  test('rotated cookies are persisted for the next restart', async () => {
    const first = restart();
    await first.connect(first.pair(owner).pair, session);
    transport.mockImplementation(async () => new Response('<input id="rut">', { headers: { 'Set-Cookie': 'PHPSESSID=rotated-session; path=/' } }));
    await first.status(owner);
    await first.close();
    const second = restart();
    expect(second.sessions.get(owner).cookies.get('PHPSESSID')).toBe('rotated-session');
    await second.close();
  });

  test('keep-alive never extends the absolute session age', async () => {
    const first = restart({ keepAliveMs: 10 * 60_000 });
    await first.connect(first.pair(owner).pair, session);
    const created = first.sessions.get(owner).created;
    jest.spyOn(Date, 'now').mockReturnValue(created + MAX_SESSION_AGE - 1);
    first.sessions.get(owner).touched = created + MAX_SESSION_AGE - 20 * 60_000;
    await first.keepAlive();
    expect(first.sessions.has(owner)).toBe(true);
    expect(first.sessions.get(owner).created).toBe(created);
    Date.now.mockReturnValue(created + MAX_SESSION_AGE);
    await expect(first.status(owner)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    expect(fs.existsSync(stateFile)).toBe(false);
    await first.close();
  });
});
