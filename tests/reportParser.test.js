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

  it('debe ignorar rangos terapéuticos de INR y metadatos de equipo', () => {
    const text = `
    PROTROMBINA - INR
    INR : 1,06
    Profilaxis trombosis venosa : 2.0 - 3.0
    Prevención tromb. recidivante y tratamiento : 2.5 - 4.0
    Profilaxis arteriales y válvulas cardiacas : 3.0 - 4.5
    SARS COV-2
    PCR SARS-CoV-19 : NEGATIVO
    Equipo analizador : 7500 Fast Real-Time PCR System - Applied Biosystems
    `;

    const result = parseReportText(text);

    expect(result.map(row => row.analysis)).toEqual(['INR', 'PCR SARS-CoV-19']);
  });

  it('debe normalizar la relación albumina creatininuria como RAC sin confundir creatininuria', () => {
    const text = `
    RELAC. ALBUMINA/CREATINURIA
    Creatininuria : 177,4 mg/dL | 70,0 - 140,0
    Microalbuminuria : 181 mg/L | < 250
    Relacion Albumina/Creatininuri : 102,0 | < 30,0
    `;

    const result = parseReportText(text);

    expect(result).toEqual([
      {
        section: 'RELAC. ALBUMINA/CREATINURIA',
        analysis: 'Creatininuria',
        result: '177,4',
        unit: 'mg/dL',
        refValue: '70,0 - 140,0'
      },
      {
        section: 'RELAC. ALBUMINA/CREATINURIA',
        analysis: 'Microalbuminuria',
        result: '181',
        unit: 'mg/L',
        refValue: '< 250'
      },
      {
        section: 'RELAC. ALBUMINA/CREATINURIA',
        analysis: 'RAC',
        result: '102,0',
        unit: '',
        refValue: '< 30,0'
      }
    ]);
  });

  it('debe ignorar edad y líneas de valor de referencia que no son analitos', () => {
    const text = `
    CREA + VFG MDRD MUJER
    Edad : 67,0
    Valor de referencia : > 3,5 ng/mL
    Glicemia : 138 mg/dL | 70 - 100
    `;

    const result = parseReportText(text);

    expect(result).toEqual([
      {
        section: 'CREA + VFG MDRD MUJER',
        analysis: 'Glicemia',
        result: '138',
        unit: 'mg/dL',
        refValue: '70 - 100'
      }
    ]);
  });

  it('debe conservar hemoglobina glicosilada como analito metabólico válido', () => {
    const text = `
    HEMOGLOBINA GLICOSILADA #2
    Hemoglobina Glicosilada : 6,6 o/o 4,0 - 6,5
    Glucosa promedio estimada : 142,7 mg/dL
    `;

    const result = parseReportText(text);

    expect(result[0]).toEqual({
      section: 'HEMOGLOBINA GLICOSILADA #2',
      analysis: 'Hemoglobina Glicosilada',
      result: '6,6',
      unit: 'o/o',
      refValue: '4,0 - 6,5'
    });
  });
});
