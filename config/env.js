/**
 * @fileoverview Configuración global inyectada vía variables de entorno.
 */
require('dotenv').config();
const { parseAllowedExtensionIds } = require('../utils/extensionOriginPolicy');

module.exports = {
  port: process.env.PORT || 3000,
  host: '127.0.0.1',
  debugArtifacts: process.env.SYSLAB_DEBUG_ARTIFACTS === 'true',
  allowedExtensionIds: parseAllowedExtensionIds(process.env.SYSLAB_ALLOWED_EXTENSION_IDS),
  syslab: {
    baseUrl: process.env.SYSLAB_BASE_URL || 'http://10.4.69.90/syslab/',
    user: process.env.SYSLAB_USER || '',
    pass: process.env.SYSLAB_PASS || ''
  }
};
