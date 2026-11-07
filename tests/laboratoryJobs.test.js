const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JobStore } = require('../services/jobStore');
const { LaboratoryJobs } = require('../services/laboratoryJobs');
const { issueReportLink } = require('../services/reportAccess');
const config = require('../config/env');
const owner = 'a'.repeat(64);
const other = 'b'.repeat(64);
const patient = { rutBody: '11111111', episodeId: 'synthetic-episode', admissionDate: '2026-11-01' };
const cohort = { patients: [patient], censusDate: '2026-11-07' };
let directory, store, scraper;
const links = count => Array.from({ length: count }, (_, i) => issueReportLink(`detalleexamenes.php?id=${i + 1}`, patient.rutBody));
const text = 'Rut/Fic : 11.111.111-1\nBIOQUIMICA\nGlucosa : 90 mg/dL 70 - 100';
const manager = () => new LaboratoryJobs({ store, scraper, autoStart: false });

beforeEach(() => {
  config.apiToken = 'synthetic-token'.repeat(4);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-jobs-'));
  store = new JobStore(directory);
  scraper = {
    withAuthenticatedContext: jest.fn(operation => operation({ synthetic: true })),
    readValidatedPdf: jest.fn(async () => ({ text })),
    getExamsList: jest.fn(async () => ({ success: true, data: links(2).map((link, i) => ({
      id: String(i + 1), link, date: '02/11/2026', time: '08:00', patientName: 'SYNTHETIC', origin: 'TEST', exams: ['Glucosa'], validationSignature: 'Glucosa(V)',
    })) })),
  };
});
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

test('32 reports use one session, checkpoint each report, and account explicitly for unvalidated orders', async () => {
  const queue = manager();
  const selection = links(32);
  scraper.readValidatedPdf.mockImplementation(async (_context, link) => {
    expect(link).toMatch(/^hhr-syslab-remote:/);
    return scraper.readValidatedPdf.mock.calls.length === 2 ? { pending: true } : { text };
  });
  const job = queue.create(owner, 'details', { links: selection });
  expect(queue.get(owner, job.id).status).toBe('queued');
  await queue.drain();
  const result = { ...queue.get(owner, job.id), ...queue.result(owner, job.id) };
  expect(result).toMatchObject({ status: 'completed', completed: 32, total: 32, omittedIndices: [1] });
  expect(result.data).toHaveLength(31);
  expect(scraper.withAuthenticatedContext).toHaveBeenCalledTimes(1);
  expect(new Set([...result.data.map(item => selection[item.index]), ...result.omittedIndices.map(index => selection[index])])).toEqual(new Set(selection));
  const ciphertext = fs.readFileSync(path.join(directory, 'laboratory.enc'));
  expect(ciphertext.toString()).not.toContain('Glucosa');
  expect(ciphertext.toString()).not.toContain(patient.rutBody);
  expect(fs.statSync(path.join(directory, 'laboratory.key')).mode & 0o777).toBe(0o600);
});

test('restart and explicit retry resume after the last confirmed report without duplicating it', async () => {
  let queue = manager();
  const job = queue.create(owner, 'details', { links: links(4) });
  scraper.readValidatedPdf.mockResolvedValueOnce({ text }).mockRejectedValueOnce(new Error('PRIVATE URL AND SECRET'));
  await queue.drain();
  expect(queue.get(owner, job.id)).toMatchObject({ status: 'failed', completed: 1 });
  queue = manager();
  queue.change(owner, job.id, 'retry');
  await queue.drain();
  expect(queue.get(owner, job.id)).toMatchObject({ status: 'completed', completed: 4 });
  expect(queue.result(owner, job.id).data).toHaveLength(4);
  expect(scraper.readValidatedPdf).toHaveBeenCalledTimes(5);
  expect(JSON.stringify(queue.get(owner, job.id))).not.toContain('PRIVATE');
});

test('inbox is scoped to operator and episode, unchanged orders are reused and changed reports become unread', async () => {
  const queue = manager();
  queue.create(owner, 'census', cohort);
  await queue.drain();
  let state = queue.censusState(owner, cohort);
  expect(state.unread).toBe(2);
  const entry = state.entries[0];
  queue.review(owner, entry.id, entry.revision);
  queue.create(owner, 'census', cohort);
  await queue.drain();
  expect(scraper.readValidatedPdf).toHaveBeenCalledTimes(2);
  expect(queue.censusState(owner, cohort).unread).toBe(1);
  expect(queue.censusState(other, cohort).entries).toEqual([]);
  expect(queue.censusState(owner, { ...cohort, patients: [{ ...patient, episodeId: 'readmission' }] }).entries).toEqual([]);
  expect(() => queue.review(other, entry.id, entry.revision)).toThrow('no disponible');
  scraper.readValidatedPdf.mockResolvedValue({ text: text.replace('90', '95') });
  queue.create(owner, 'census', { ...cohort, force: true });
  await queue.drain();
  state = queue.censusState(owner, cohort);
  expect(state.unread).toBe(2);
  expect(() => queue.review(owner, entry.id, entry.revision)).toThrow('cambió');
});

test('failed refresh preserves known findings and is not an empty successful census', async () => {
  const queue = manager();
  const initial = queue.create(owner, 'census', cohort);
  await queue.drain();
  scraper.getExamsList.mockRejectedValue(new Error('offline'));
  const update = queue.create(owner, 'census', cohort);
  await queue.drain();
  expect(queue.get(owner, update.id)).toMatchObject({ status: 'partial', patients: [{ status: 'failed' }] });
  expect(queue.censusState(owner, cohort).entries).toHaveLength(2);
  expect(() => queue.get(other, initial.id)).toThrow('no disponible');
});

test('cancellation during an in-flight report prevents publishing it and explicit retry preserves earlier work', async () => {
  const queue = manager();
  const job = queue.create(owner, 'details', { links: links(2) });
  scraper.readValidatedPdf.mockImplementationOnce(async () => {
    queue.change(owner, job.id, 'cancel');
    return { text };
  });
  await queue.drain();
  expect(queue.get(owner, job.id)).toMatchObject({ status: 'cancelled', completed: 0 });
  queue.change(owner, job.id, 'retry');
  await queue.drain();
  expect(queue.get(owner, job.id)).toMatchObject({ status: 'completed', completed: 2 });
});

test('rejects mixed patients, invalid dates, duplicate subjects and mismatched revisions', () => {
  const queue = manager();
  expect(() => queue.create(owner, 'details', { links: [...links(1), issueReportLink('detalleexamenes.php?id=2', '22222222')] })).toThrow('mezcla');
  expect(() => queue.create(owner, 'census', { ...cohort, censusDate: '2026-02-30' })).toThrow();
  expect(() => queue.create(owner, 'census', { ...cohort, patients: [patient, patient] })).toThrow('duplicados');
  const job = queue.create(owner, 'details', { links: links(1) });
  expect(() => queue.get(other, job.id)).toThrow('no disponible');
});


test('historical census views do not show later reports of the same episode', async () => {
  const queue = manager();
  queue.create(owner, 'census', cohort); await queue.drain();
  expect(queue.censusState(owner, { ...cohort, censusDate: '2026-11-01' }).entries).toEqual([]);
});

test('disk write failure never confirms a checkpoint and explicit retry recovers the durable queue', async () => {
  const queue = manager();
  const job = queue.create(owner, 'details', { links: links(2) });
  const originalSave = store.save.bind(store);
  let writes = 0;
  const save = jest.spyOn(store, 'save').mockImplementation(state => {
    if (++writes >= 2) throw new Error('synthetic disk full');
    return originalSave(state);
  });
  await expect(queue.drain()).rejects.toThrow('disk full');
  expect(queue.get(owner, job.id)).toMatchObject({ status: 'failed', completed: 0 });
  expect(queue.get(owner, job.id).errors[0]).toContain('guardar');
  save.mockRestore();
  expect(queue.create(owner, 'details', { links: links(2) }).id).toBe(job.id); await queue.drain();
  expect(queue.get(owner, job.id)).toMatchObject({ status: 'completed', completed: 2 });
});

test('encrypted state is never silently reset when its key is missing or the ciphertext is damaged', () => {
  const queue = manager(); queue.create(owner, 'details', { links: links(1) });
  const ciphertext = path.join(directory, 'laboratory.enc');
  const bytes = fs.readFileSync(ciphertext); bytes[30] ^= 1; fs.writeFileSync(ciphertext, bytes);
  expect(() => new JobStore(directory).load()).toThrow();
  fs.unlinkSync(path.join(directory, 'laboratory.key'));
  expect(() => new JobStore(directory)).toThrow('clave');
});


test('two windows with freshly issued references share one active read without changing its report positions', async () => {
  const queue = manager();
  const first = queue.create(owner, 'details', { links: links(3) });
  const second = queue.create(owner, 'details', { links: links(3) });
  expect(second.id).toBe(first.id);
  await queue.drain();
  expect(scraper.readValidatedPdf).toHaveBeenCalledTimes(3);
  expect(queue.result(owner, first.id).data.map(item => item.index)).toEqual([0, 1, 2]);
  expect(queue.get(owner, first.id)).not.toHaveProperty('data');
});

test('large results are paginated without losing positions', async () => {
  const queue = manager();
  const job = queue.create(owner, 'details', { links: links(80) }); await queue.drain();
  const first = queue.result(owner, job.id);
  expect(first.data).toHaveLength(50); expect(first.nextOffset).toBe(50);
  const last = queue.result(owner, job.id, first.nextOffset);
  expect(last.data).toHaveLength(30); expect(last.nextOffset).toBe(null);
  expect([...first.data, ...last.data].map(item => item.index)).toEqual(Array.from({ length: 80 }, (_, i) => i));
});
