const admin = require('firebase-admin');
const logger = require('../utils/logger');
require('dotenv').config();

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    logger.info('Firebase Admin inicializado exitosamente mediante credenciales (JSON).');
  } else {
    admin.initializeApp();
    logger.info('Firebase Admin inicializado (Fallback Default).');
  }
} catch (error) {
  logger.error(`Error crítico inicializando Firebase Admin: ${error.message}`);
}

const db = admin.firestore();

module.exports = { admin, db };
