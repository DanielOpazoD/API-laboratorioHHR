const scraperOrchestrator = require('../services/scraperOrchestrator');
const logger = require('../utils/logger');

exports.getExams = async (req, res, next) => {
  const { rut } = req.query;
  if (!rut) {
    return res.status(400).json({ success: false, error: 'Se requiere un RUT válido para la búsqueda.' });
  }

  try {
    logger.info(`API: Iniciando búsqueda para RUT: ${rut}`);
    const result = await scraperOrchestrator.getExamsList(rut);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getExamsDetails = async (req, res, next) => {
  const { links } = req.body;
  
  if (!links || !Array.isArray(links)) {
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
