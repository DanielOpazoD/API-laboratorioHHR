const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const config = require('./config/env');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');
const { createJobRoutes } = require('./routes/jobs');

const createApp = ({ getJobs } = {}) => {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use((req, res, next) => {
    if (config.apiToken.length < 32) return res.status(503).json({ success: false, error: 'Servicio sin configurar.' });
    const expected = Buffer.from('Bearer ' + config.apiToken);
    const supplied = Buffer.from(req.get('authorization') || '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  // Process liveness only: recovery must not confuse a Syslab outage with a dead Node process.
  app.get('/live', (_req, res) => res.json({ success: true, service: 'syslab-scraper' }));
  app.get('/health', async (_req, res) => {
    try {
      const scraper = require('./services/scraperOrchestrator');
      await scraper.withAuthenticatedContext(async () => {});
      res.json({ success: true, connected: true, service: 'syslab-scraper', version: '2.0.0' });
    } catch {
      res.status(503).json({ success: false, connected: false, error: 'No se pudo iniciar sesión en Syslab desde el Mac mini.' });
    }
  });
  app.use('/api', createJobRoutes(getJobs));
  app.use('/api', apiRoutes);
  app.use((err, _req, res, _next) => {
    logger.warn('No se pudo completar una solicitud de laboratorio.');
    res.status(err.status === 413 ? 413 : 502).json({
      success: false,
      error: 'No se pudo completar la consulta. Comprueba la conexión del Mac mini y actualiza la búsqueda.'
    });
  });
  return app;
};

if (require.main === module) {
  if (config.apiToken.length < 32 || !config.syslab.user || !config.syslab.pass) {
    console.error('Configura SYSLAB_API_TOKEN (mínimo 32 caracteres), SYSLAB_USER y SYSLAB_PASS en .env.');
    process.exitCode = 1;
  } else {
    const server = createApp().listen(config.port, config.host, () => {
      try {
        // Acquire the unique listener before opening or recovering durable work.
        require('./services/laboratoryJobs').getLaboratoryJobs();
        logger.info('Servidor Syslab disponible en loopback.');
      } catch {
        logger.error('No se pudo abrir la cola privada de laboratorio. Conserva sus archivos y revisa el almacenamiento.');
        server.close(() => { process.exitCode = 1; });
      }
    });
    server.on('error', () => {
      logger.error('No se pudo iniciar el servidor Syslab. Comprueba que no exista otro proceso sobre el mismo puerto.');
      process.exitCode = 1;
    });
  }
}
module.exports = { createApp };
