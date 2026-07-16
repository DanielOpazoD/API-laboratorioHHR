const { chromium } = require('playwright');
const scraperOrchestrator = require('../services/scraperOrchestrator');

describe('scraperOrchestrator exam list extraction', () => {
  let browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it('includes Syslab rows without odd/even class', async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <base href="http://10.4.69.90/syslab/">
      <table class="narrow">
        <tr><th>Orden</th><th>Fecha</th></tr>
        <tr class="">
          <td><a href="detalleexamenes.php?id=43092446&user=abc">43092446</a></td>
          <td>02/05/2026<br>06:09:55</td>
          <td>10096004 4</td>
          <td>TATARATA ,LUCIE TITAUA</td>
          <td>HOSPITALIZADO</td>
          <td><table class="mitabla"><tr><td>GASES VENOSOS.(V)</td></tr></table></td>
        </tr>
        <tr class="odd">
          <td><a href="detalleexamenes.php?id=43092427&user=abc">43092427</a></td>
          <td>30/04/2026<br>15:28:51</td>
          <td>10096004 4</td>
          <td>TATARATA ,LUCIE TITAUA</td>
          <td>HOSPITALIZADO</td>
          <td><table class="mitabla"><tr><td>PCR PANEL RESPIRATORIO #2.(V)</td></tr></table></td>
        </tr>
      </table>
    `);

    const exams = await page.evaluate(scraperOrchestrator.extractExamsFromDocument);
    await page.close();

    expect(exams.map(exam => exam.id)).toEqual(['43092446', '43092427']);
    expect(exams[0]).toMatchObject({
      date: '02/05/2026',
      time: '06:09:55',
      rutBody: '10096004',
      exams: ['GASES VENOSOS.'],
    });
    expect(scraperOrchestrator.examRowsMatchRut(exams, '10.096.004')).toBe(true);
    expect(scraperOrchestrator.examRowsMatchRut(exams, '17752753')).toBe(false);
  });
});
