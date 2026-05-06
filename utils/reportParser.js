/**
 * @fileoverview Parser de texto crudo extraído de PDFs de Syslab (HHR).
 *
 * Formato esperado por línea:
 *   <NOMBRE_ANALISIS> : <VALOR> <UNIDAD> [<RANGO_REFERENCIA>]
 *   o
 *   <NOMBRE_ANALISIS> : <RESULTADO_CUALITATIVO>
 *
 * Las secciones se detectan como líneas en MAYÚSCULAS sin ":" (ej: BIOQUIMICA,
 * PERFIL HEPATICO, ELECTROLITOS PLASMATICOS).
 */

const SKIP_PATTERNS = [
  /^HOSPITAL\s+DE\s+/i,
  /^Laboratorio\s+Cl[íi]nico/i,
  /^Nombre\s*:/i,
  /^Rut\/?Fic\s*:/i,
  /^Fecha\s+de\s+Nac/i,
  /^Procedencia\s*:/i,
  /^Fecha\s+y\s+Hora/i,
  /^Fecha\s+de\s+impresi[óo]n/i,
  /^E\s+X\s+A\s+M\s+E\s+N\s+E\s+S\s*$/,
  /^Director\s+T[ée]cnico/i,
  /^Resultado\s+Via\s+WEB/i,
  /^Resultado\s+Unidad\s+Valor\s+de\s+Referencia/i,
  /^Nota\s*:/i,
  /^Valores?\s+(de\s+)?[Rr]eferencia/i,
  /^Ni[ñn]os?(\s*\/\s*Ni[ñn]as?)?\s+\d/i,
  /^Adultos\s+[<>]/i,
  /^Para\s+valores/i,
  /^se\s+recomienda/i,
  /^_+$/,
  /^TM\s+[A-ZÁÉÍÓÚÑ]/, // firma técnico-médico
];

// Sección: mayúsculas (con espacios, +, -, /, #, dígitos), sin ":"
const SECTION_REGEX = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9\s\+\-\/\#\.]{2,60}$/;

// Línea numérica:
//   <name> : [|] <value> [resto: unidad y ref]
const NUMERIC_REGEX = /^(.+?)\s*:\s*\|?\s*([<>]?\s*[\d.,]+)(.*)$/;

// Línea cualitativa: nombre : RESULTADO
const QUALITATIVE_REGEX =
  /^(.+?)\s*:\s*(NEGATIVO|POSITIVO|NORMAL|AUSENTE|PRESENTE|REACTIVO|NO\s+REACTIVO|DETECTADO|NO\s+DETECTADO|ESCASA|MODERADA|ABUNDANTE|NO\s+SE\s+OBSERVA(?:N)?)\s*$/i;

const NON_ANALYTIC_ANALYSIS_PATTERNS = [
  /^Edad$/i,
  /^Valor\s+de\s+referencia$/i,
  /^Profilaxis\s+trombosis\s+venosa$/i,
  /^Prevenci[oó]n\s+tromb\.\s+recidivante\s+y\s+tratamiento$/i,
  /^Profilaxis\s+arteriales\s+y\s+v[aá]lvulas\s+cardiacas$/i,
  /^Equipo\s+analizador$/i,
];

const normalizeForMatch = value =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function shouldSkipAnalysis(analysis) {
  return NON_ANALYTIC_ANALYSIS_PATTERNS.some(pattern => pattern.test(analysis.trim()));
}

function normalizeAnalysisName(analysis) {
  const normalized = normalizeForMatch(analysis);
  if (
    normalized.includes('relacion albumina/creatininuri') ||
    normalized.includes('relac. albumina/creatininuri')
  ) {
    return 'RAC';
  }

  return analysis;
}

function splitUnitAndRef(rest) {
  const cleaned = rest.replace(/^\s*\|+\s*|\s*\|+\s*$/g, '').trim();
  if (!cleaned) return { unit: '', refValue: '' };
  if (/^[<>]/.test(cleaned)) return { unit: '', refValue: cleaned.replace(/\|+/g, '').trim() };

  const firstSpace = cleaned.search(/\s/);
  if (firstSpace === -1) return { unit: cleaned, refValue: '' };

  return {
    unit: cleaned.substring(0, firstSpace),
    refValue: cleaned
      .substring(firstSpace + 1)
      .replace(/\|+/g, '')
      .replace(/^I\s+/, '')
      .trim(),
  };
}

function parseReportText(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const parsedData = [];
  let currentSection = 'GENERAL';

  for (let line of lines) {
    line = line.trim();
    if (line.length < 3) continue;
    if (SKIP_PATTERNS.some(p => p.test(line))) continue;

    // Sección (sin ":")
    if (!line.includes(':') && SECTION_REGEX.test(line)) {
      currentSection = line.replace(/\s+/g, ' ').trim();
      continue;
    }

    // Cualitativo (más específico, intenta primero)
    let m = line.match(QUALITATIVE_REGEX);
    if (m) {
      const analysis = normalizeAnalysisName(m[1].trim());
      if (analysis.length < 2 || analysis.length > 60 || analysis.includes(':')) continue;
      if (shouldSkipAnalysis(analysis)) continue;
      parsedData.push({
        section: currentSection,
        analysis,
        result: m[2].trim().toUpperCase(),
        unit: '',
        refValue: '',
        qualitative: true,
      });
      continue;
    }

    // Numérico
    m = line.match(NUMERIC_REGEX);
    if (m) {
      const analysis = normalizeAnalysisName(m[1].trim());
      const result = m[2].replace(/\s+/g, '');
      const { unit, refValue } = splitUnitAndRef(m[3] || '');

      // Filtros: nombres con ":" embebido (= cabecera multi-campo) se descartan
      if (analysis.length < 2 || analysis.length > 60) continue;
      if (analysis.includes(':')) continue;
      if (shouldSkipAnalysis(analysis)) continue;

      parsedData.push({
        section: currentSection,
        analysis,
        result,
        unit,
        refValue,
      });
    }
  }

  return parsedData;
}

module.exports = { parseReportText };
