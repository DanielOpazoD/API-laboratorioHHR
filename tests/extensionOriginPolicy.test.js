const {
  isAllowedRequestOrigin,
  parseAllowedExtensionIds,
} = require('../utils/extensionOriginPolicy');

describe('extension origin policy', () => {
  const trustedId = 'abcdefghijklmnopabcdefghijklmnop';

  it('parses only valid Chrome extension ids', () => {
    expect(parseAllowedExtensionIds(`${trustedId}, invalid, ${trustedId.toUpperCase()}`)).toEqual([
      trustedId,
      trustedId,
    ]);
  });

  it('allows local clients without Origin and only configured extension origins', () => {
    expect(isAllowedRequestOrigin(undefined, [trustedId])).toBe(true);
    expect(isAllowedRequestOrigin(undefined, [trustedId], 'cross-site')).toBe(false);
    expect(isAllowedRequestOrigin(`chrome-extension://${trustedId}`, [trustedId])).toBe(true);
    expect(
      isAllowedRequestOrigin('chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba', [trustedId])
    ).toBe(false);
    expect(isAllowedRequestOrigin('https://fichamedico.rayensalud.cl', [trustedId])).toBe(false);
  });
});
