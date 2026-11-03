const scraperOrchestrator = require('../services/scraperOrchestrator');
const logger = require('../utils/logger');

exports.getExams = async (req, res, next) => {
  const { rut } = req.query;
  if (typeof rut !== 'string' || !/^\d{5,9}$/.test(rut)) {
    return res.status(400).json({ success: false, error: 'Se requiere un RUT válido para la búsqueda.' });
  }

  try {
    logger.info('API: consulta de órdenes.');
    const result = await scraperOrchestrator.getExamsList(rut);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getExamPdf = async (req, res, next) => {
  const { link } = req.query;
  if (!link) {
    return res.status(400).json({ success: false, error: 'Se requiere el parámetro link.' });
  }

  try {
    logger.info('API: lectura de informe.');
    const buffer = await scraperOrchestrator.getExamPdf(link);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

exports.getExamsDetails = async (req, res, next) => {
  const { links } = req.body;
  
  if (!Array.isArray(links) || links.length < 1 || links.length > 3 || links.some(link => typeof link !== 'string')) {
    return res.status(400).json({ success: false, error: 'Se requiere una lista de enlaces para obtener detalles.' });
  }

  try {
    logger.info(`API: Obteniendo detalles para ${links.length} órdenes.`);
    const result = await scraperOrchestrator.getExamsDetails(links);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
