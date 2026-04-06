const { db } = require('../config/firebaseAdmin');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const HOSPITAL_ID = process.env.HOSPITAL_ID || 'salvador';

class FirebaseIntegrationService {
  constructor() {
    this.patientsCollection = `hospitals/${HOSPITAL_ID}/patients`;
    this.clinicalCollection = `hospitals/${HOSPITAL_ID}/clinicalDocuments`;
  }

  /**
   * Obtiene la nómina de todos los RUTs de pacientes actuales
   */
  async getActivePatientsRuts() {
    try {
      logger.info('Descargando master list de pacientes desde Firestore...');
      // Limitamos a 50 para seguridad en test local
      const snapshot = await db.collection(this.patientsCollection).limit(50).get();
      if (snapshot.empty) return [];
      
      const ruts = snapshot.docs.map(doc => doc.id);
      logger.info(`Recuperados ${ruts.length} RUTs desde master list.`);
      return ruts;
    } catch (error) {
      logger.error('Error obteniendo pacientes desde Firebase:', error.message);
      throw error;
    }
  }

  /**
   * Guarda los findings tabulados directamente como ClinicalDocumentRecord
   */
  async saveLabResults(rut, findings, originalUrl) {
    try {
      const uniqueId = uuidv4();
      const docRef = db.collection(this.clinicalCollection).doc(uniqueId);

      const payload = {
        id: uniqueId,
        episodeKey: rut, // Default simplificado, usualmente contiene el RUT
        documentType: 'laboratorio_syslab',
        patientId: rut,
        audit: {
          updatedAt: new Date().toISOString(),
          updatedBy: 'syslab-scraper-service'
        },
        status: 'signed',
        isLocked: true,
        data: findings,
        metadata: {
          originUrl: originalUrl,
          extractedAt: new Date().toISOString()
        }
      };

      await docRef.set(payload, { merge: true });
      logger.info(`[✓] Guardado en HHR Firebase - Documento Lab para RUT: ${rut} (UUID: ${uniqueId})`);
    } catch (error) {
      logger.error(`[X] Error escribiendo a Firebase (RUT: ${rut}):`, error.message);
      throw error;
    }
  }
}

module.exports = new FirebaseIntegrationService();
