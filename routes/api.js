const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');

/**
 * GET /api/exams
 * Query params: rut
 */
router.get('/exams', examController.getExams);

/**
 * GET /api/exams/pdf
 * Query params: batchId, examId
 * Returns: raw PDF bytes (application/pdf)
 */
router.get('/exams/pdf', examController.getExamPdf);

/**
 * POST /api/exams/details
 * Body: { batchId: string, examIds: string[] }
 */
router.post('/exams/details', examController.getExamsDetails);

module.exports = router;
