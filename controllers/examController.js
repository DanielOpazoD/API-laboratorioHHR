const scraperOrchestrator = require('../services/scraperOrchestrator');
const examBatchStore = require('../services/examBatchStore');
const logger = require('../utils/logger');

exports.getExams = async (req, res, next) => {
  const { rut } = req.query;
  if (!rut) {
    return res.status(400).json({ success: false, error: 'Se requiere un RUT válido para la búsqueda.' });
  }

  try {
    logger.info('API: Iniciando búsqueda de laboratorio por RUN.');
    const result = await scraperOrchestrator.getExamsList(rut);
    const batch = examBatchStore.create(result.rutBody, result.data);
    res.json({ success: true, batchId: batch.batchId, rutBody: batch.rutBody, data: batch.exams });
  } catch (error) {
    next(error);
  }
};

exports.getExamPdf = async (req, res, next) => {
  const { batchId, examId } = req.query;
  const resolved = examBatchStore.resolveOne(batchId, examId);
  if (!resolved) {
    return res.status(404).json({ success: false, error: 'El lote o informe solicitado no está vigente.' });
  }

  try {
    logger.info(`API: Descargando PDF para orden ${resolved.exam.id}.`);
    const buffer = await scraperOrchestrator.getExamPdf(resolved.exam.link, resolved.rutBody);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

exports.getExamsDetails = async (req, res, next) => {
  const { batchId, examIds } = req.body || {};
  const resolved = examBatchStore.resolve(batchId, examIds);

  if (!resolved) {
    return res.status(400).json({
      success: false,
      error: 'El lote o las órdenes solicitadas no son válidas o ya caducaron.',
    });
  }

  try {
    logger.info(`API: Obteniendo detalles para ${resolved.exams.length} órdenes.`);
    const result = await scraperOrchestrator.getExamsDetails(
      resolved.exams.map(exam => exam.link),
      resolved.rutBody
    );
    const examIdByLink = new Map(resolved.exams.map(exam => [exam.link, exam.id]));
    res.json({
      success: true,
      batchId: String(batchId),
      rutBody: result.rutBody,
      data: result.data.map(({ url, ...detail }) => ({ examId: examIdByLink.get(url), ...detail })),
    });
  } catch (error) {
    next(error);
  }
};
