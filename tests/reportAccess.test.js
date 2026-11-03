const config = require('../config/env');
const { issueReportLink, readReportLink, assertReportPatient, isAllowedResource } = require('../services/reportAccess');

beforeEach(() => { config.apiToken = 'test'.repeat(16); });
afterEach(() => jest.useRealTimers());

test('report references conceal the internal URL and reject tampering and expiry', () => {
  jest.useFakeTimers();
  const link = 'http://10.4.69.90/syslab/detalleexamenes.php?id=123';
  const ref = issueReportLink(link, '11111111');
  expect(ref).not.toContain('10.4.69.90');
  expect(readReportLink(ref)).toEqual({ link, rutBody: '11111111' });
  expect(() => readReportLink(ref.slice(0, -8) + 'AAAAAAAA')).toThrow();
  expect(() => readReportLink(link)).toThrow();
  jest.advanceTimersByTime(30 * 60 * 1000);
  expect(() => readReportLink(ref)).toThrow();
});
test('only report URLs on Syslab can be issued', () => {
  for (const link of ['http://127.0.0.1/admin', 'https://example.com/a.pdf', 'http://10.4.69.90/syslab/../admin']) {
    expect(() => issueReportLink(link, '11111111')).toThrow();
  }
  expect(isAllowedResource('http://10.4.69.90/syslab/resultados.pdf')).toBe(true);
  expect(isAllowedResource('http://10.4.69.90/privado')).toBe(false);
});
test('every page must identify the requested patient; missing and mixed identities fail', () => {
  expect(() => assertReportPatient('Rut/Fic : 11.111.111-1\nHEMOGRAMA', '11111111')).not.toThrow();
  for (const text of ['Iniciar sesión', 'Rut/Fic : 22.222.222-2', 'Rut/Fic : 11.111.111-1\nRut/Fic : 22.222.222-2']) {
    expect(() => assertReportPatient(text, '11111111')).toThrow();
  }
});
