const fs = require('node:fs');
const path = require('node:path');
const writeMacConfig = (file, settings) => {
  const { syslab_user: user, syslab_pass: pass, syslab_token: token, syslab_url: url } = settings;
  if (!user || !pass || !token || token.length < 32) throw new Error('Faltan credenciales o clave compartida.');
  const tunnel = new URL(url);
  if (tunnel.protocol !== 'https:' || tunnel.username || tunnel.password || tunnel.pathname !== '/') {
    throw new Error('El túnel debe ser un origen HTTPS sin rutas ni credenciales.');
  }
  const encoded = value => Buffer.from(value, 'utf8').toString('base64');
  const lines = [
    'HOST=127.0.0.1', 'PORT=3100', 'SYSLAB_BASE_URL=http://10.4.69.90/syslab/',
    `SYSLAB_USER_BASE64=${encoded(user)}`, `SYSLAB_PASS_BASE64=${encoded(pass)}`,
    `SYSLAB_API_TOKEN_BASE64=${encoded(token)}`, `SYSLAB_PROXY_URL=${tunnel.origin}`, ''
  ];
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};
if (require.main === module) writeMacConfig(path.resolve(__dirname, '../.env'), process.env);
module.exports = { writeMacConfig };
