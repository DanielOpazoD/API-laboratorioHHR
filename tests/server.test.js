const config = require('../config/env');
const scraper = require('../services/scraperOrchestrator');
const { createApp } = require('../server');
let server, base;
beforeAll(async () => {
  config.apiToken = 'test'.repeat(16);
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
afterEach(() => jest.restoreAllMocks());
const request = (path, options = {}) => fetch(base + path, {
  ...options, headers: { Authorization: 'Bearer ' + config.apiToken, ...options.headers }
});
test('rejects direct requests and never exposes a public search endpoint', async () => {
  const response = await fetch(base + '/api/exams?rut=11111111');
  expect(response.status).toBe(401);
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
});
test('health verifies the Syslab session rather than only process uptime', async () => {
  jest.spyOn(scraper, 'withAuthenticatedContext').mockRejectedValueOnce(new Error('synthetic failure'));
  expect((await request('/health')).status).toBe(503);
  jest.spyOn(scraper, 'withAuthenticatedContext').mockResolvedValueOnce(undefined);
  expect(await (await request('/health')).json()).toMatchObject({ connected: true });
});
test('liveness is authenticated and does not log in or query Syslab', async () => {
  const login = jest.spyOn(scraper, 'withAuthenticatedContext');
  expect((await fetch(base + '/live')).status).toBe(401);
  const response = await request('/live');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ success: true, service: 'syslab-scraper' });
  expect(login).not.toHaveBeenCalled();
});
test('refuses malformed identities and unbounded detail requests', async () => {
  expect((await request('/api/exams?rut=PASSPORT123')).status).toBe(400);
  const response = await request('/api/exams/details', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: ['a','b','c','d'] }) });
  expect(response.status).toBe(400);
});
test('a failed clinical request contains no raw exception, URL or credentials', async () => {
  jest.spyOn(scraper, 'getExamsList').mockRejectedValueOnce(new Error('secret-internal-error'));
  const response = await request('/api/exams?rut=11111111');
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('secret-internal-error');
});
