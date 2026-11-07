const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JobStore } = require('../services/jobStore');
const { LaboratoryJobs } = require('../services/laboratoryJobs');
const { issueReportLink } = require('../services/reportAccess');
const config = require('../config/env');
const owner = 'a'.repeat(64);
const patient = { rutBody: '11111111', episodeId: 'synthetic-period', admissionDate: '2026-11-01' };
const cohort = { patients: [patient], censusDate: '2026-11-07' };
const custom = { ...cohort, dateRange: { from: '2026-10-31', to: '2026-11-08' } };
let directory, scraper;
const manager = () => new LaboratoryJobs({ store: new JobStore(directory), scraper, autoStart: false });

beforeEach(() => {
  config.apiToken = 'synthetic-token'.repeat(4);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-period-'));
  scraper = {
    withAuthenticatedContext: jest.fn(operation => operation({})),
    readValidatedPdf: jest.fn(async () => ({ text: 'Rut/Fic : 11.111.111-1\nBIOQUIMICA\nGlucosa : 90 mg/dL 70 - 100' })),
    getExamsList: jest.fn(async () => ({ success: true, data: ['31/10/2026', '01/11/2026', '07/11/2026', '08/11/2026'].map((date, i) => ({
      id: String(i), date, time: '08:00', exams: ['Glucosa'],
      link: issueReportLink(`detalleexamenes.php?id=${i}`, patient.rutBody), validationSignature: 'Glucosa(V)',
    })) })),
  };
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

test('default range includes admission and census day, excluding earlier and later orders', async () => {
  const queue = manager();
  queue.create(owner, 'census', cohort);
  await queue.drain();
  expect(queue.censusState(owner, cohort).entries.map(entry => entry.exam.date).sort()).toEqual(['01/11/2026', '07/11/2026']);
  expect(scraper.readValidatedPdf).toHaveBeenCalledTimes(2);
});

test('custom range survives restart, includes both boundaries and keeps the census identity', async () => {
  let queue = manager();
  const job = queue.create(owner, 'census', custom);
  queue = manager();
  await queue.drain();
  const state = queue.censusState(owner, custom);
  expect(state.entries).toHaveLength(4);
  expect(state.jobs.map(item => item.id)).toEqual([job.id]);
  expect(queue.censusState(owner, cohort).entries).toHaveLength(2);
  expect(queue.censusState(owner, cohort).jobs).toEqual([]);
  expect(queue.censusState(owner, { ...custom, patients: [{ ...patient, episodeId: 'another-episode' }] }).entries).toEqual([]);
});

test('narrowing or widening a range does not erase review state or reuse a different active job', async () => {
  const queue = manager();
  const first = queue.create(owner, 'census', custom);
  const second = queue.create(owner, 'census', cohort);
  expect(second.id).not.toBe(first.id);
  await queue.drain();
  const entry = queue.censusState(owner, custom).entries.find(item => item.exam.date === '31/10/2026');
  queue.review(owner, entry.id, entry.revision);
  expect(queue.censusState(owner, cohort).unread).toBe(2);
  expect(queue.censusState(owner, custom).unread).toBe(3);
});

test.each([null, {}, [], '2026-11-01', { from: '2026-11-07' }, { from: '2026-02-30', to: '2026-11-07' }, { from: '2026-11-08', to: '2026-11-07' }])('rejects an invalid range for writes and reads: %j', dateRange => {
  const queue = manager();
  for (const operation of [() => queue.create(owner, 'census', { ...cohort, dateRange }), () => queue.censusState(owner, { ...cohort, dateRange })]) {
    expect(operation).toThrow('período válido');
  }
});
