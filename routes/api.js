const express = require('express');
const router = express.Router();
const scraperService = require('../services/scraperService');

/**
 * GET /api/exams
 * Query params: rut
 */
router.get('/exams', async (req, res) => {
  const { rut } = req.query;
  
  if (!rut) {
    return res.status(400).json({ 
      success: false, 
      error: 'Se requiere un RUT válido para la búsqueda.' 
    });
  }

  try {
    console.log(`[API] Iniciando búsqueda para RUT: ${rut}`);
    const result = await scraperService.getExamsList(rut);
    res.json(result);
  } catch (error) {
    console.error('[API] Error en /exams:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno al procesar el scraping.',
      details: error.message 
    });
  }
});

/**
 * POST /api/exams/details
 * Body: { links: string[] }
 */
router.post('/exams/details', async (req, res) => {
  const { links } = req.body;
  
  if (!links || !Array.isArray(links)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Se requiere una lista de enlaces para obtener detalles.' 
    });
  }

  try {
    console.log(`[API] Obteniendo detalles para ${links.length} órdenes.`);
    const result = await scraperService.getExamsDetails(links);
    res.json(result);
  } catch (error) {
    console.error('[API] Error en /exams/details:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Error al extraer detalles profundos.',
      details: error.message 
    });
  }
});

module.exports = router;
