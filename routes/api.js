const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const syncController = require('../controllers/syncController');

/**
 * GET /api/exams
 * Query params: rut
 */
router.get('/exams', examController.getExams);

/**
 * POST /api/exams/details
 * Body: { links: string[] }
 */
router.post('/exams/details', examController.getExamsDetails);

/**
 * POST /api/sync/labs
 * Inicia la sincronización masiva de pacientes HHR -> Syslab -> HHR
 */
router.post('/sync/labs', syncController.runSync);

module.exports = router;
