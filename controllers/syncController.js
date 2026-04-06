const firebaseIntegrationService = require('../services/firebaseIntegrationService');
const scraperOrchestrator = require('../services/scraperOrchestrator');
const logger = require('../utils/logger');

exports.runSync = async (req, res, next) => {
  try {
    logger.info('API: Iniciando sincronización masiva y silenciosa con entorno HHR');
    
    // Responder inmediatamente para no hacer request timeout en Express
    res.json({ 
      success: true, 
      message: 'El orquestador de sincronizaciones a Firebase se ejecutará en background.' 
    });
    
    // Proceso secundario (Daemon Flow)
    (async () => {
      try {
         const ruts = await firebaseIntegrationService.getActivePatientsRuts();
         logger.info(`Sincronización HHR: ${ruts.length} pacientes pendientes.`);

         for (const rut of ruts) {
            try {
              // 1. Pregunta a Syslab
              const syslabInfo = await scraperOrchestrator.getExamsList(rut);
              if (!syslabInfo.data || syslabInfo.data.length === 0) continue;
              
              // 2. Extrae enlaces PDF/Textos
              const linksToFetch = syslabInfo.data.map(exam => exam.link).filter(Boolean);
              if (linksToFetch.length > 0) {
                 const details = await scraperOrchestrator.getExamsDetails(linksToFetch);
                 
                 // 3. Escribe directo a Firestore
                 for (const detail of details.data) {
                    await firebaseIntegrationService.saveLabResults(rut, detail.findings, detail.url);
                 }
              }
            } catch (err) {
              logger.error(`Fallo bloqueante sincronizando RUT: ${rut}. Error: ${err.message}`);
            }
         }
         logger.info('✅ Sincronización completa finalizada exitosamente.');
      } catch (err) {
         logger.error(`Error fatal en worker de sincronización HHR: ${err.message}`);
      }
    })();
  } catch (error) {
    next(error);
  }
};
