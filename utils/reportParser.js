/**
 * @fileoverview Funciones puras para parsear texto de reportes de laboratorio.
 */

/**
 * Parsea el texto crudo extraído de un PDF de exámenes.
 * @param {string} text - Texto completo del reporte PDF.
 * @returns {Array} Array de hallazgos en formato JSON.
 */
function parseReportText(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const parsedData = [];
  let currentSection = 'GENERAL';

  // Expresión regular estructurada
  const flexibleRegex = /([A-Z\s\+\d\/\-\(\)\.\%]+?)\s*[:]?\s*([\d\.\,<>]+)\s*([A-Za-z\/\d\%]*)\s*[|I\s]+([^|I\n\r]+)/;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.length < 4) continue;

    // Detectar título de sección
    if (line.match(/^[A-Z\s\+\/]{5,35}$/) && !line.includes('RESULTADO') && !line.includes('FECHA')) {
      currentSection = line;
      continue;
    }

    const match = line.match(flexibleRegex);
    if (match) {
      const analysis = match[1].trim();
      // Filtrar ruidos
      if (analysis.length < 3 || analysis.includes('PROCEDENCIA') || analysis.includes('EDAD')) continue;

      parsedData.push({
        section: currentSection,
        analysis: analysis,
        result: match[2].trim(),
        unit: match[3].trim(),
        refValue: match[4].trim()
      });
    }
  }

  return parsedData;
}

module.exports = {
  parseReportText
};
