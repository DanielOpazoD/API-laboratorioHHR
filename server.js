const express = require('express');
const path = require('path');
const config = require('./config/env');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Interceptar peticiones para Logging
app.use((req, res, next) => {
  logger.info(`[REQ] ${req.method} ${req.url}`);
  next();
});

// Rutas
app.use('/api', apiRoutes);

// Manejo de errores global centralizado
app.use((err, req, res, next) => {
  logger.error(`Error no manejado: ${err.stack || err.message}`);
  res.status(500).json({
    success: false,
    error: '¡Error interno al procesar el scraping!',
    details: err.message
  });
});

app.listen(config.port, () => {
  logger.info(`
  🚀 Aplicación Syslab 2.0 refactorizada
  --------------------------------------
  Local:   http://localhost:${config.port}
  API:     http://localhost:${config.port}/api/exams?rut=...
  --------------------------------------
  `);
});
