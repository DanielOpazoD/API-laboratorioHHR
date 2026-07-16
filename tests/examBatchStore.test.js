const { ExamBatchStore } = require('../services/examBatchStore');

const exam = (id, link = `http://10.4.69.90/syslab/detalleexamenes.php?id=${id}`) => ({
  id: String(id),
  link,
  rutBody: '10096004',
  date: '15/07/2026',
  exams: ['Hemograma'],
});

describe('ExamBatchStore', () => {
  it('returns an opaque public batch without Syslab links or duplicated RUN fields', () => {
    const store = new ExamBatchStore();
    const batch = store.create('10.096.004-2', [exam(1)]);

    expect(batch.batchId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(batch.rutBody).toBe('10096004');
    expect(batch.exams).toEqual([{ id: '1', date: '15/07/2026', exams: ['Hemograma'] }]);
    expect(JSON.stringify(batch.exams)).not.toContain('10.4.69.90');
  });

  it('resolves only order ids that belong to the same live batch', () => {
    const store = new ExamBatchStore();
    const batch = store.create('10096004', [exam(1), exam(2)]);

    expect(store.resolve(batch.batchId, ['2']).exams[0].link).toContain('id=2');
    expect(store.resolve(batch.batchId, ['3'])).toBeNull();
    expect(store.resolve(batch.batchId, ['1', '1'])).toBeNull();
  });

  it('rejects report URLs outside the exact private Syslab route', () => {
    const store = new ExamBatchStore();

    expect(() => store.create('10096004', [exam(1, 'https://evil.test/syslab/detalleexamenes.php')]))
      .toThrow('órdenes Syslab inválidas');
    expect(() => store.create('10096004', [exam(1, 'http://10.4.69.90/admin/export.php')]))
      .toThrow('órdenes Syslab inválidas');
  });

  it('expires batches after the configured TTL', () => {
    let now = 1000;
    const store = new ExamBatchStore({ ttlMs: 50, now: () => now });
    const batch = store.create('10096004', [exam(1)]);
    now += 51;

    expect(store.get(batch.batchId)).toBeNull();
  });

  it('evicts the oldest batch when the store reaches its bound', () => {
    const store = new ExamBatchStore({ maxBatches: 1 });
    const first = store.create('10096004', [exam(1)]);
    const second = store.create('10096004', [exam(2)]);

    expect(store.get(first.batchId)).toBeNull();
    expect(store.get(second.batchId)).not.toBeNull();
  });
});
