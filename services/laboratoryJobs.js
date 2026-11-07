const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { JobStore } = require('./jobStore');
const { readReportLink, issueReportLink } = require('./reportAccess');
const { parseReportText } = require('../utils/reportParser');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const subjectKey = patient => `${patient.rutBody}:${patient.episodeId}`;
const badRequest = message => Object.assign(new Error(message), { status: 400 });
const assertOwner = owner => {
  if (typeof owner !== 'string' || !/^[a-f0-9]{64}$/.test(owner)) {
    throw Object.assign(new Error('Identidad de operador requerida.'), { status: 401 });
  }
};
const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().startsWith(value);
const sourceDay = value => {
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || '');
  const day = parts && `${parts[3]}-${parts[2]}-${parts[1]}`;
  if (!isoDay(day)) throw new Error('Fecha de orden no reconocida.');
  return day;
};

const validatePatients = (patients, censusDate) => {
  if (!isoDay(censusDate) || !Array.isArray(patients) || !patients.length || patients.length > 60) {
    throw badRequest('Selecciona entre 1 y 60 pacientes y una fecha válida.');
  }
  const keys = new Set();
  return patients.map(patient => {
    if (!patient || !/^\d{5,9}$/.test(patient.rutBody) || typeof patient.episodeId !== 'string' ||
        !patient.episodeId.trim() || patient.episodeId.length > 128 || !isoDay(patient.admissionDate) ||
        patient.admissionDate > censusDate || keys.has(subjectKey(patient))) {
      throw badRequest('La selección requiere RUN, episodio y fecha de ingreso propios, sin duplicados.');
    }
    keys.add(subjectKey(patient));
    return { rutBody: patient.rutBody, episodeId: patient.episodeId, admissionDate: patient.admissionDate };
  });
};

/** One worker, durable checkpoints, no clinical writes to the census or production Firebase. */
class LaboratoryJobs {
  constructor({ store, scraper, autoStart = true }) {
    this.store = store;
    this.scraper = scraper;
    this.state = store.load();
    this.busy = false;
    this.autoStart = autoStart;
    this.update(state => {
      for (const job of Object.values(state.jobs)) if (job.status === 'running') job.status = 'queued';
    });
    this.schedule();
  }

  update(change) {
    const next = structuredClone(this.state);
    const result = change(next);
    try { this.store.save(next); } catch (error) { this.storageError = true; throw error; }
    this.state = next;
    return result;
  }

  create(owner, kind, input) {
    assertOwner(owner);
    if (this.storageError) {
      this.update(state => { for (const item of Object.values(state.jobs)) if (item.status === 'running') item.status = 'queued'; });
      this.storageError = false;
      this.schedule();
    }
    let payload;
    if (kind === 'census') {
      payload = { patients: validatePatients(input.patients, input.censusDate), censusDate: input.censusDate, force: input.force === true };
    } else if (kind === 'details') {
      if (!Array.isArray(input.links) || !input.links.length || input.links.length > 500 ||
          new Set(input.links).size !== input.links.length) throw badRequest('Selección de informes no válida.');
      const references = input.links.map(readReportLink);
      if (new Set(references.map(ref => ref.rutBody)).size !== 1) throw badRequest('La selección mezcla pacientes.');
      // Decrypt only at admission. Expiring public references do not invalidate durable work.
      payload = { reports: references.map((ref, index) => ({ ...ref, original: input.links[index] })) };
    } else throw badRequest('Tipo de trabajo no válido.');
    const fingerprint = hash([owner, kind, kind === 'details' ? payload.reports.map(({ link, rutBody }) => ({ link, rutBody })) : payload]);
    const existing = Object.values(this.state.jobs).find(job => job.owner === owner &&
      job.fingerprint === fingerprint && (['queued', 'running'].includes(job.status) ||
        (kind === 'details' && ['failed', 'cancelled'].includes(job.status))));
    if (existing) {
      if (['failed', 'cancelled'].includes(existing.status)) this.change(owner, existing.id, 'retry');
      this.schedule();
      return this.get(owner, existing.id);
    }
    if (Object.values(this.state.jobs).filter(job => job.owner === owner && ['queued', 'running'].includes(job.status)).length >= 3) {
      throw Object.assign(new Error('Ya tienes tres trabajos pendientes.'), { status: 429 });
    }
    const id = randomUUID();
    this.update(state => {
      state.jobs[id] = { id, owner, kind, payload, fingerprint, status: 'queued',
        createdAt: new Date().toISOString(), completed: 0, total: kind === 'details' ? payload.reports.length : payload.patients.length,
        data: [], omittedUrls: [], patients: [], errors: [] };
    });
    this.schedule();
    return this.get(owner, id);
  }

  owned(owner, id) {
    assertOwner(owner);
    const job = this.state.jobs[id];
    if (!job || job.owner !== owner) throw Object.assign(new Error('Trabajo no disponible.'), { status: 404 });
    return job;
  }

  get(owner, id) {
    const job = this.owned(owner, id);
    const { payload, fingerprint, owner: _owner, data, omittedUrls, ...result } = job;
    if (this.storageError && ['queued', 'running'].includes(job.status)) return { ...structuredClone(result), status: 'failed', errors: ['El Mac mini no pudo guardar la cola. Recupera espacio y reintenta; lo confirmado se conserva.'] };
    return structuredClone(result);
  }

  result(owner, id, offset = 0) {
    const job = this.owned(owner, id);
    if (job.kind !== 'details' || job.status !== 'completed') throw Object.assign(new Error('Resultado pendiente.'), { status: 409 });
    if (!Number.isInteger(offset) || offset < 0 || offset > job.total) throw badRequest('Página no válida.');
    const byUrl = new Map(job.data.map(detail => [detail.url, detail]));
    const omitted = new Set(job.omittedUrls);
    const data = [], omittedIndices = [];
    let cursor = offset, bytes = 0;
    while (cursor < job.total && cursor - offset < 50) {
      const url = job.payload.reports[cursor].original;
      const detail = byUrl.get(url);
      if (!detail && !omitted.has(url)) throw new Error('Resultado incompleto.');
      const size = Buffer.byteLength(JSON.stringify(detail || url));
      if (size > 1024 * 1024) throw Object.assign(new Error('Informe demasiado grande.'), { status: 413 });
      if (bytes + size > 1024 * 1024) break;
      if (detail) data.push({ index: cursor, findings: detail.findings }); else omittedIndices.push(cursor);
      bytes += size; cursor += 1;
    }
    return { data, omittedIndices, nextOffset: cursor < job.total ? cursor : null };
  }

  change(owner, id, action) {
    const job = this.owned(owner, id);
    if (action === 'retry' && this.storageError) {
      this.update(state => { for (const item of Object.values(state.jobs)) if (item.status === 'running') item.status = 'queued'; });
      this.storageError = false;
      this.schedule();
    }
    if (action === 'cancel' && ['queued', 'running'].includes(job.status)) {
      this.update(state => { state.jobs[id].status = 'cancelled'; });
    } else if (action === 'retry' && ['failed', 'cancelled', 'partial'].includes(job.status)) {
      this.update(state => {
        const target = state.jobs[id];
        if (target.kind === 'census') {
          target.patients = target.patients.filter(patient => patient.status === 'ready');
          target.completed = target.patients.length;
        }
        target.status = 'queued'; target.errors = [];
      });
      this.schedule();
    }
    return this.get(owner, id);
  }

  censusState(owner, input) {
    assertOwner(owner);
    const patients = validatePatients(input.patients, input.censusDate);
    const subjects = new Set(patients.map(subjectKey));
    const admissions = new Map(patients.map(patient => [subjectKey(patient), patient.admissionDate]));
    const entries = Object.values(this.state.inbox[owner] || {}).filter(entry => subjects.has(entry.subjectKey) && sourceDay(entry.exam.date) >= admissions.get(entry.subjectKey) && sourceDay(entry.exam.date) <= input.censusDate);
    entries.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id));
    const offset = Number.isInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
    const listed = input.onlyUnread ? entries.filter(entry => !entry.reviewedAt) : entries;
    const page = [];
    let cursor = offset, bytes = 0;
    while (cursor < listed.length && cursor - offset < 100) {
      const { sourceLink, rutBody, ...entry } = listed[cursor];
      const item = { ...entry, exam: { ...entry.exam, link: issueReportLink(sourceLink, rutBody) } };
      const size = Buffer.byteLength(JSON.stringify(item));
      if (size > 1024 * 1024) throw Object.assign(new Error('Informe demasiado grande.'), { status: 413 });
      if (bytes + size > 1024 * 1024) break;
      page.push(item); bytes += size; cursor += 1;
    }
    return {
      entries: page,
      nextOffset: cursor < listed.length ? cursor : null,
      unread: entries.filter(entry => !entry.reviewedAt).length,
      jobs: Object.values(this.state.jobs).filter(job => job.owner === owner && job.kind === 'census' &&
        job.payload.censusDate === input.censusDate && job.payload.patients.some(patient => subjects.has(subjectKey(patient))))
        .slice(-20).reverse().map(job => this.get(owner, job.id)),
    };
  }

  review(owner, id, revision) {
    assertOwner(owner);
    const entry = this.state.inbox[owner]?.[id];
    if (!entry) throw Object.assign(new Error('Resultado no disponible.'), { status: 404 });
    // A delayed click must not acknowledge a newer version of a report.
    if (entry.revision !== revision) throw Object.assign(new Error('El informe cambió. Actualiza la bandeja.'), { status: 409 });
    this.update(state => { state.inbox[owner][id].reviewedAt = new Date().toISOString(); });
  }

  schedule() {
    if (this.autoStart && !this.busy) setImmediate(() => this.drain().catch(() => {}));
  }

  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      let job;
      while ((job = Object.values(this.state.jobs).find(item => item.status === 'queued'))) {
        const id = job.id;
        this.update(state => { state.jobs[id].status = 'running'; });
        try {
          if (job.kind === 'details') await this.readDetails(id);
          else await this.readCensus(id);
          if (this.state.jobs[id].status === 'running') this.update(state => {
            state.jobs[id].status = state.jobs[id].errors.length ? 'partial' : 'completed';
            state.jobs[id].finishedAt = new Date().toISOString();
          });
        } catch {
          if (this.state.jobs[id].status === 'running') this.update(state => {
            state.jobs[id].status = 'failed';
            state.jobs[id].errors = ['No se pudo completar la lectura. Puedes reintentar lo pendiente.'];
          });
        }
      }
    } finally { this.busy = false; }
  }

  async readDetails(id) {
    await this.scraper.withAuthenticatedContext(async context => {
      while (this.state.jobs[id].status === 'running') {
        const job = this.state.jobs[id];
        if (job.completed >= job.payload.reports.length) break;
        const report = job.payload.reports[job.completed];
        const material = await this.scraper.readValidatedPdf(context, issueReportLink(report.link, report.rutBody), true);
        if (this.state.jobs[id].status !== 'running') break;
        this.update(state => {
          const target = state.jobs[id];
          const original = target.payload.reports[target.completed].original;
          if (material.pending) target.omittedUrls.push(original);
          else target.data.push({ url: original, findings: parseReportText(material.text) });
          target.completed += 1;
        });
      }
    });
  }

  async readCensus(id) {
    for (const patient of this.state.jobs[id].payload.patients) {
      if (this.state.jobs[id].status !== 'running') break;
      const key = subjectKey(patient);
      if (this.state.jobs[id].patients.some(item => item.subjectKey === key && item.status === 'ready')) continue;
      try {
        const response = await this.scraper.getExamsList(patient.rutBody);
        if (!response.success || !Array.isArray(response.data)) throw new Error('Lectura fallida.');
        const through = this.state.jobs[id].payload.censusDate;
        const exams = response.data.filter(exam => {
          const day = sourceDay(exam.date);
          return exam.link && day >= patient.admissionDate && day <= through;
        });
        if (exams.length > 500) throw new Error('Selección demasiado grande.');
        const references = new Map(exams.map(exam => {
          const reference = readReportLink(exam.link);
          if (reference.rutBody !== patient.rutBody) throw new Error('Informe de otro paciente.');
          return [exam.link, reference];
        }));
        let reports = 0, pending = 0;
        this.update(state => { state.jobs[id].reportProgress = { subjectKey: key, completed: 0, total: exams.length }; });
        // Compare the original PDF contents: validation/amendments can keep the same order ID.
        // One session per patient replaces one browser and login per three reports.
        if (exams.length) await this.scraper.withAuthenticatedContext(async context => {
          for (const exam of exams) {
            if (this.state.jobs[id].status !== 'running') return;
            const entryId = hash([key, exam.id, exam.date, exam.time]);
            const sourceVersion = hash([exam.id, exam.date, exam.time, exam.exams, exam.validationSignature]);
            const known = this.state.inbox[this.state.jobs[id].owner]?.[entryId];
            if (known?.sourceVersion === sourceVersion && !this.state.jobs[id].payload.force) {
              reports += 1;
              this.update(state => { state.jobs[id].reportProgress = { subjectKey: key, completed: reports, total: exams.length }; });
              continue;
            }
            const reference = references.get(exam.link);
            const material = await this.scraper.readValidatedPdf(context, issueReportLink(reference.link, patient.rutBody), true);
            if (this.state.jobs[id].status !== 'running') return;
            if (material.pending) pending += 1;
            if (!material.pending) {
              const findings = parseReportText(material.text);
              const revision = hash(material.text.split('\n').filter(line => !/^\s*Fecha\s+de\s+impresi[oó]n/i.test(line)).join('\n'));
              this.update(state => {
                const inbox = state.inbox[this.state.jobs[id].owner] ||= {};
                const previous = inbox[entryId];
                const { link: _link, patientName: _name, ...metadata } = exam;
                inbox[entryId] = { id: entryId, subjectKey: key, rutBody: patient.rutBody,
                  sourceLink: reference.link, exam: metadata, findings, revision, sourceVersion,
                  detectedAt: previous?.revision === revision ? previous.detectedAt : new Date().toISOString(),
                  reviewedAt: previous?.revision === revision ? previous.reviewedAt : null };
              });
            }
            reports += 1;
            this.update(state => { state.jobs[id].reportProgress = { subjectKey: key, completed: reports, total: exams.length }; });
          }
        });
        if (this.state.jobs[id].status !== 'running') break;
        this.update(state => { state.jobs[id].patients.push({ subjectKey: key, status: 'ready', reports: exams.length, pending, checkedAt: new Date().toISOString() }); });
      } catch {
        if (this.state.jobs[id].status !== 'running') break;
        this.update(state => {
          state.jobs[id].patients.push({ subjectKey: key, status: 'failed' });
          state.jobs[id].errors.push('Un paciente no pudo actualizarse; se conserva lo conocido.');
        });
      }
      this.update(state => { state.jobs[id].completed += 1; });
    }
  }
}

let manager;
const getLaboratoryJobs = () => manager ||= new LaboratoryJobs({
  store: new JobStore(process.env.SYSLAB_STATE_DIR || path.join(__dirname, '../state')),
  scraper: require('./scraperOrchestrator'),
});

module.exports = { LaboratoryJobs, getLaboratoryJobs, validatePatients };
