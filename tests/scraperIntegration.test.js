const http = require('node:http');
const config = require('../config/env');
const scraper = require('../services/scraperOrchestrator');
let fixture;
let previous;
let pdf;
let mixed = false;

// Minimal original PDF, entirely synthetic, with a valid cross-reference table.
const makePdf = rut => {
  const stream = `BT /F1 12 Tf 72 720 Td (Rut/Fic : ${rut}) Tj 0 -20 Td (BIOQUIMICA) Tj 0 -20 Td (Glucosa : 90 mg/dL 70 - 100) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  content += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
};

beforeAll(async () => {
  previous = { ...config.syslab };
  config.apiToken = 'test'.repeat(16);
  config.syslab.user = 'synthetic'; config.syslab.pass = 'synthetic';
  pdf = makePdf('11.111.111-1');
  fixture = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/syslab/login') {
      res.writeHead(302, { 'Set-Cookie': 'session=synthetic; Path=/syslab/; HttpOnly', Location: '/syslab/aplicacion.php' }); return res.end();
    }
    if (!(req.headers.cookie || '').includes('session=synthetic')) {
      return res.end('<form action="/syslab/login" method="POST"><input name="usuario"><input name="password" type="password"><input type="submit" value="Ingresar"></form>');
    }
    if (url.pathname.endsWith('aplicacion.php') || url.pathname === '/syslab/') return res.end('<a href="parbusqueRut.php">Búsqueda por RUT</a>');
    if (url.pathname.endsWith('parbusqueRut.php')) return res.end('<form action="results.php"><input name="rut"><input type="submit" value="Aceptar"></form>');
    if (url.pathname.endsWith('results.php')) return res.end(`<table class="narrow"><tr><td><a href="detalleexamenes.php?id=123">123</a></td><td>01/11/2026<br>08:00</td><td>${mixed ? '22222222' : '11111111'} 1</td><td>PACIENTE SINTETICO</td><td>HOSPITALIZADO</td><td><table class="mitabla"><tr><td>GLUCOSA(V)</td></tr></table></td></tr></table>`);
    if (url.pathname.endsWith('detalleexamenes.php') && url.searchParams.get('id') === '999') return res.end('<script>/* No hay exámenes validados */</script>');
    if (url.pathname.endsWith('detalleexamenes.php')) return res.end('<iframe src="report.pdf"></iframe>');
    if (url.pathname.endsWith('report.pdf')) { res.setHeader('Content-Type', 'application/pdf'); return res.end(pdf); }
    res.writeHead(404); res.end();
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => fixture.on('listening', resolve));
  config.syslab.baseUrl = `http://127.0.0.1:${fixture.address().port}/syslab/`;
});
afterAll(async () => { Object.assign(config.syslab, previous); await new Promise(resolve => fixture.close(resolve)); });

test('search, details and original PDF work against an authenticated synthetic Syslab portal', async () => {
  const result = await scraper.getExamsList('11111111');
  expect(result.success).toBe(true);
  expect(result.data[0].link).toMatch(/^hhr-syslab-remote:\/\/report\//);
  expect(result).not.toHaveProperty('screenshot');
  const detail = await scraper.getExamsDetails([result.data[0].link]);
  expect(detail).toMatchObject({ success: true, data: [{ url: result.data[0].link, findings: [{ analysis: 'Glucosa', result: '90' }] }] });
  expect((await scraper.getExamPdf(result.data[0].link)).subarray(0, 4).toString()).toBe('%PDF');
  pdf = makePdf('22.222.222-2');
  await expect(scraper.getExamsDetails([result.data[0].link])).rejects.toThrow('RUN');
  mixed = true;
  await expect(scraper.getExamsList('11111111')).rejects.toThrow('otro paciente');
}, 30_000);


test('32 source reports including an unvalidated order finish in one authenticated queue session', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { JobStore } = require('../services/jobStore');
  const { LaboratoryJobs } = require('../services/laboratoryJobs');
  const { issueReportLink } = require('../services/reportAccess');
  mixed = false; pdf = makePdf('11.111.111-1');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-real-portal-jobs-'));
  const login = jest.spyOn(scraper, 'withAuthenticatedContext');
  try {
    const links = Array.from({ length: 32 }, (_, i) => issueReportLink('detalleexamenes.php?id=' + (i === 1 ? 999 : i + 1), '11111111'));
    const queue = new LaboratoryJobs({ store: new JobStore(directory), scraper, autoStart: false });
    const job = queue.create('a'.repeat(64), 'details', { links });
    await queue.drain();
    expect(queue.get('a'.repeat(64), job.id)).toMatchObject({ status: 'completed', completed: 32, total: 32 });
    const result = queue.result('a'.repeat(64), job.id);
    expect(result.data).toHaveLength(31);
    expect(result.omittedIndices).toEqual([1]);
    expect(result.data.every(item => item.findings[0].analysis === 'Glucosa')).toBe(true);
    expect(login).toHaveBeenCalledTimes(1);
  } finally { login.mockRestore(); fs.rmSync(directory, { recursive: true, force: true }); }
}, 60_000);
