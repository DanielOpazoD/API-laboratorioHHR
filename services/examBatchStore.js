const { randomUUID } = require('crypto');
const config = require('../config/env');

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_BATCHES = 100;
const MAX_EXAMS_PER_REQUEST = 24;

const normalizeRutBody = value => String(value || '')
  .replace(/\./g, '')
  .replace(/-.*$/, '')
  .replace(/\D/g, '');

const isAllowedSyslabLink = value => {
  try {
    const url = new URL(String(value || ''));
    const reportUrl = new URL('detalleexamenes.php', config.syslab.baseUrl);
    return url.origin === reportUrl.origin && !url.username && !url.password &&
      url.pathname.toLowerCase() === reportUrl.pathname.toLowerCase();
  } catch (_error) {
    return false;
  }
};

class ExamBatchStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxBatches = DEFAULT_MAX_BATCHES, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxBatches = maxBatches;
    this.now = now;
    this.batches = new Map();
  }

  sweepExpired() {
    const now = this.now();
    for (const [batchId, batch] of this.batches) {
      if (now - batch.createdAt > this.ttlMs) this.batches.delete(batchId);
    }
  }

  create(rutBody, exams) {
    const normalizedRut = normalizeRutBody(rutBody);
    if (!/^\d{5,9}$/.test(normalizedRut) || !Array.isArray(exams)) {
      throw new Error('No se puede crear un lote de laboratorio inválido.');
    }
    const normalizedExams = exams.map(exam => ({ ...exam, id: String(exam && exam.id || '') }));
    if (normalizedExams.some(exam => !/^\d+$/.test(exam.id) || !isAllowedSyslabLink(exam.link))) {
      throw new Error('El lote contiene órdenes Syslab inválidas.');
    }
    if (new Set(normalizedExams.map(exam => exam.id)).size !== normalizedExams.length) {
      throw new Error('El lote contiene identificadores de orden duplicados.');
    }

    this.sweepExpired();
    while (this.batches.size >= this.maxBatches) {
      this.batches.delete(this.batches.keys().next().value);
    }

    const batchId = randomUUID();
    this.batches.set(batchId, {
      rutBody: normalizedRut,
      createdAt: this.now(),
      exams: normalizedExams,
    });
    return {
      batchId,
      rutBody: normalizedRut,
      exams: normalizedExams.map(({ link: _link, rutBody: _rutBody, ...exam }) => exam),
    };
  }

  get(batchId) {
    this.sweepExpired();
    if (!/^[0-9a-f-]{36}$/i.test(String(batchId || ''))) return null;
    return this.batches.get(String(batchId)) || null;
  }

  resolve(batchId, examIds) {
    const batch = this.get(batchId);
    const ids = Array.isArray(examIds) ? examIds.map(String) : [];
    if (!batch || !ids.length || ids.length > MAX_EXAMS_PER_REQUEST || new Set(ids).size !== ids.length) {
      return null;
    }
    const byId = new Map(batch.exams.map(exam => [exam.id, exam]));
    const exams = ids.map(id => byId.get(id));
    return exams.every(Boolean) ? { rutBody: batch.rutBody, exams } : null;
  }

  resolveOne(batchId, examId) {
    const resolved = this.resolve(batchId, [examId]);
    return resolved ? { rutBody: resolved.rutBody, exam: resolved.exams[0] } : null;
  }
}

module.exports = new ExamBatchStore();
module.exports.ExamBatchStore = ExamBatchStore;
module.exports.MAX_EXAMS_PER_REQUEST = MAX_EXAMS_PER_REQUEST;
