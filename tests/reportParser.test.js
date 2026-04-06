const { parseReportText } = require('../utils/reportParser');

describe('reportParser', () => {
  it('debe retornar un array vacío si no hay texto', () => {
    expect(parseReportText(null)).toEqual([]);
    expect(parseReportText('')).toEqual([]);
  });

  it('debe parsear correctamente una línea válida', () => {
    const text = `
    HEMOGRAMA
    LEUCOCITOS : 7.6 uL I 4.0 - 11.0
    `;
    const result = parseReportText(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      section: 'HEMOGRAMA',
      analysis: 'LEUCOCITOS',
      result: '7.6',
      unit: 'uL',
      refValue: '4.0 - 11.0'
    });
  });

  it('debe ignorar líneas irrelevantes como EDAD o PROCEDENCIA', () => {
    const text = `
    PERFIL BIOQUIMICO
    PROCEDENCIA AMBULATORIO
    COLESTEROL TOTAL : 180 mg/dL I < 200
    EDAD 45 Anos
    `;
    const result = parseReportText(text);
    expect(result).toHaveLength(1);
    expect(result[0].analysis).toBe('COLESTEROL TOTAL');
  });

  it('debe mantener la sección correcta para múltiples exámenes', () => {
    const text = `
    PERFIL LIPIDICO
    COLESTEROL TOTAL : 180 mg/dL | < 200
    TRIGLICERIDOS : 110 mg/dL | < 150
    `;
    const result = parseReportText(text);
    expect(result).toHaveLength(2);
    expect(result[0].section).toBe('PERFIL LIPIDICO');
    expect(result[1].section).toBe('PERFIL LIPIDICO');
  });
});
