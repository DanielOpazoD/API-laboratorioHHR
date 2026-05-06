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
});
