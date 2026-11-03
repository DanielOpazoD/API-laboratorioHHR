const { createHash, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const config = require('../config/env');
const PREFIX = 'hhr-syslab-remote://report/';
const TTL_MS = 30 * 60 * 1000;

const accessError = () => new Error('El informe no pertenece a una búsqueda vigente. Actualiza el visor.');
const key = () => {
  if (config.apiToken.length < 32) throw new Error('Falta configurar SYSLAB_API_TOKEN.');
  return createHash('sha256').update(config.apiToken).digest();
};
const validateReportUrl = value => {
  const base = new URL(config.syslab.baseUrl);
  const url = new URL(value, base);
  if (url.origin !== base.origin || url.username || url.password ||
      url.pathname !== new URL('detalleexamenes.php', base).pathname) throw accessError();
  return url.href;
};
const isAllowedResource = value => {
  try {
    const base = new URL(config.syslab.baseUrl);
    const url = new URL(value);
    return !url.username && !url.password && url.origin === base.origin &&
      url.pathname.startsWith(base.pathname);
  } catch { return false; }
};
const issueReportLink = (link, rutBody) => {
  const payload = JSON.stringify({ link: validateReportUrl(link), rutBody, expires: Date.now() + TTL_MS });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
};
const readReportLink = value => {
  try {
    if (typeof value !== 'string' || !value.startsWith(PREFIX) || value.length > 4096) throw accessError();
    const bytes = Buffer.from(value.slice(PREFIX.length), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    if (!Number.isFinite(payload.expires) || payload.expires <= Date.now() ||
        !/^\d{5,9}$/.test(payload.rutBody)) throw accessError();
    return { link: validateReportUrl(payload.link), rutBody: payload.rutBody };
  } catch { throw accessError(); }
};
const assertReportPatient = (text, rutBody) => {
  const bodies = String(text).split(/\r?\n/)
    .filter(line => /^\s*Rut\/?Fic\s*:/i.test(line))
    .map(line => line.replace(/^\s*Rut\/?Fic\s*:/i, '').match(/\d[\d.]*/))
    .map(match => match ? match[0].replace(/\D/g, '') : '');
  if (!bodies.length || bodies.some(body => body !== rutBody)) {
    throw new Error('El informe no corresponde al RUN solicitado o no permite verificarlo.');
  }
};
module.exports = { issueReportLink, readReportLink, validateReportUrl, isAllowedResource, assertReportPatient };
