const config = require('../config/env');
const { ExalabService, assertPdfPatient } = require('../services/exalabService');
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
  await expect(service.status(owner)).resolves.toEqual({ connected: true });
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
