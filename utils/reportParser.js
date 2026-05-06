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

function splitUnitAndRef(rest) {
  const cleaned = rest.replace(/^\|+\s*|\s*\|+$/g, '').trim();
  if (!cleaned) return { unit: '', refValue: '' };

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
      const analysis = m[1].trim();
      if (analysis.length < 2 || analysis.length > 60 || analysis.includes(':')) continue;
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
      const analysis = m[1].trim();
      const result = m[2].replace(/\s+/g, '');
      const { unit, refValue } = splitUnitAndRef(m[3] || '');

      // Filtros: nombres con ":" embebido (= cabecera multi-campo) se descartan
      if (analysis.length < 2 || analysis.length > 60) continue;
      if (analysis.includes(':')) continue;

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
