const express = require('express');
const path = require('path');
const config = require('./config/env');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');
const cors = require('cors');
const { isAllowedRequestOrigin } = require('./utils/extensionOriginPolicy');

const app = express();

if (!config.syslab.user || !config.syslab.pass || !config.allowedExtensionIds.length) {
  throw new Error(
    'Configura SYSLAB_USER, SYSLAB_PASS y SYSLAB_ALLOWED_EXTENSION_IDS antes de iniciar el servicio.'
  );
}

// Middlewares
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (!isAllowedRequestOrigin(origin, config.allowedExtensionIds, req.get('Sec-Fetch-Site'))) {
    return res.status(403).json({ success: false, error: 'Origen no autorizado.' });
  }
  next();
});
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedRequestOrigin(origin, config.allowedExtensionIds));
  },
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Interceptar peticiones para Logging
app.use((req, res, next) => {
  logger.info(`[REQ] ${req.method} ${req.url}`);
  next();
});

// Healthcheck (consumido por el Netlify proxy de HHR para habilitar el botón Lab)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'syslab-scraper',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Rutas
app.use('/api', apiRoutes);

// Manejo de errores global centralizado
app.use((err, req, res, next) => {
  logger.error('Error no manejado durante una operación Syslab.');
  if (config.debugArtifacts) logger.error(err.stack || err.message);
  res.status(500).json({
    success: false,
    error: 'Error interno al procesar la solicitud de laboratorio.'
  });
});

app.listen(config.port, config.host, () => {
  logger.info(`
  🚀 Aplicación Syslab 2.0 refactorizada
  --------------------------------------
  Local:   http://${config.host}:${config.port}
  API:     http://${config.host}:${config.port}/api/exams?rut=...
  --------------------------------------
  `);
});
