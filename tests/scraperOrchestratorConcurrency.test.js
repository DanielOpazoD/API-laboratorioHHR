const scraperOrchestrator = require('../services/scraperOrchestrator');

describe('scraperOrchestrator concurrency helpers', () => {
  it('limits concurrent detail workers while preserving input order', async () => {
    let active = 0;
    let maxActive = 0;

    const result = await scraperOrchestrator.mapWithConcurrency(
      ['a', 'b', 'c', 'd', 'e'],
      2,
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, item === 'a' ? 20 : 5));
        active -= 1;
        return item.toUpperCase();
      }
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('returns PDF bytes only when the embedded RUN matches the requested patient', async () => {
    const originalParser = scraperOrchestrator.extractRutBodyFromReportText;
    scraperOrchestrator.extractRutBodyFromReportText = jest.fn(() => '10096004');
    const buffer = Buffer.from('%PDF-mock');

    jest.spyOn(require('pdf-parse').PDFParse.prototype, 'getText').mockResolvedValue({
      text: 'Rut/Fic: 10.096.004-2',
    });
    const destroy = jest
      .spyOn(require('pdf-parse').PDFParse.prototype, 'destroy')
      .mockResolvedValue(undefined);

    await expect(scraperOrchestrator.validateExamPdfRut(buffer, '10096004')).resolves.toBe(buffer);
    await expect(scraperOrchestrator.validateExamPdfRut(buffer, '17752753')).rejects.toThrow(
      'no corresponde al RUN'
    );
    expect(destroy).toHaveBeenCalledTimes(2);
    scraperOrchestrator.extractRutBodyFromReportText = originalParser;
    jest.restoreAllMocks();
  });

  it('does not expose raw scraper errors in detail results', async () => {
    const page = {
      on: jest.fn(),
      goto: jest.fn().mockRejectedValue(new Error('secret URL http://10.4.69.90/syslab/?token=x')),
      waitForTimeout: jest.fn(),
      innerText: jest.fn().mockRejectedValue(new Error('secret URL')),
      close: jest.fn(),
    };
    const context = { newPage: jest.fn().mockResolvedValue(page) };

    const result = await scraperOrchestrator.processExamDetailLink(
      context,
      'http://10.4.69.90/syslab/detalleexamenes.php?id=1',
      '/tmp',
      0,
      '10096004'
    );

    expect(result.error).toBe('No se pudo validar este informe.');
    expect(JSON.stringify(result)).not.toContain('token=x');
    expect(page.close).toHaveBeenCalled();
  });
});
