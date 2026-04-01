const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rutas
app.use('/api', apiRoutes);

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('¡Algo salió mal!');
});

app.listen(PORT, () => {
  console.log(`
  🚀 Aplicación Syslab 2.0 corriendo
  -------------------------------
  Local:   http://localhost:${PORT}
  API:     http://localhost:${PORT}/api/exams?rut=...
  -------------------------------
  `);
});
