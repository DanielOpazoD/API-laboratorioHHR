/**
 * @fileoverview Configuración global inyectada vía variables de entorno.
 */
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  syslab: {
    baseUrl: process.env.SYSLAB_BASE_URL || 'http://10.4.69.90/syslab/',
    user: process.env.SYSLAB_USER || '17752753',
    pass: process.env.SYSLAB_PASS || '17752753'
  }
};
