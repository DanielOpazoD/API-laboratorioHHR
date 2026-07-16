const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

const parseAllowedExtensionIds = value => String(value || '')
  .split(',')
  .map(id => id.trim().toLowerCase())
  .filter(id => EXTENSION_ID_PATTERN.test(id));

const isAllowedRequestOrigin = (origin, allowedExtensionIds, fetchSite) => {
  if (!origin) return !fetchSite;
  const match = String(origin).match(/^chrome-extension:\/\/([a-p]{32})$/i);
  return Boolean(match && allowedExtensionIds.includes(match[1].toLowerCase()));
};

module.exports = { isAllowedRequestOrigin, parseAllowedExtensionIds };
