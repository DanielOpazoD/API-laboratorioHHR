const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { JobStore } = require('../services/jobStore');
const { LaboratoryJobs } = require('../services/laboratoryJobs');
const { issueReportLink } = require('../services/reportAccess');
const config = require('../config/env');
let server, base, directory, queue;
const owner = 'a'.repeat(64), other = 'b'.repeat(64);
const request = (url, actor = owner, body) => fetch(base + url, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: 'Bearer ' + config.apiToken, 'X-HHR-Lab-Owner': actor, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeAll(async () => {
  config.apiToken = 'synthetic-token'.repeat(4);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-job-routes-'));
  queue = new LaboratoryJobs({ store: new JobStore(directory), scraper: {}, autoStart: false });
  server = createApp({ getJobs: () => queue }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });

test('the shared bearer alone is insufficient for owner-scoped routes', async () => {
  const response = await fetch(base + '/api/jobs/details', {
    method: 'POST', headers: { Authorization: 'Bearer ' + config.apiToken, 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test('creation is asynchronous and the same operator can recover its status, never another operator', async () => {
  const link = issueReportLink('detalleexamenes.php?id=1', '11111111');
  const created = await request('/api/jobs/details', owner, { links: [link], owner: other });
  expect(created.status).toBe(202);
  const { job } = await created.json();
  expect(job.status).toBe('queued');
  expect((await request('/api/jobs/' + job.id, owner)).status).toBe(200);
  expect((await request('/api/jobs/' + job.id, other)).status).toBe(404);
  expect((await request('/api/jobs/' + job.id + '/result', other)).status).toBe(404);
  expect((await request('/api/jobs/' + job.id + '/result', owner)).status).toBe(409);
  const cancelled = await request('/api/jobs/' + job.id + '/cancel', owner, {});
  expect((await cancelled.json()).job.status).toBe('cancelled');
});
