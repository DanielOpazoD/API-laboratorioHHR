const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const config = require('../config/env');
const root = path.resolve(__dirname, '..');
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

if (process.platform !== 'darwin') throw new Error('Este instalador requiere macOS.');
if (config.apiToken.length < 32 || !config.syslab.user || !config.syslab.pass) {
  throw new Error('Completa primero .env con la clave compartida y las credenciales de Syslab.');
}
const envFile = path.join(root, '.env');
fs.chmodSync(envFile, 0o600);
const agents = path.join(os.homedir(), 'Library/LaunchAgents');
fs.mkdirSync(agents, { recursive: true });
fs.mkdirSync(path.join(root, 'logs'), { recursive: true, mode: 0o700 });
const jobs = [{ label: 'cl.hhr.syslab', args: ['/usr/bin/caffeinate', '-i', process.execPath, path.join(root, 'server.js')] }];
if (process.env.SYSLAB_PROXY_URL) {
  const url = new URL(process.env.SYSLAB_PROXY_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ngrok-free.dev') || url.pathname !== '/') {
    throw new Error('Para instalar ngrok automáticamente, SYSLAB_PROXY_URL debe ser tu dominio HTTPS de ngrok. Para Cloudflare instala su servicio por separado.');
  }
  const binary = execFileSync('/bin/zsh', ['-lc', 'command -v ngrok'], { encoding: 'utf8' }).trim();
  jobs.push({ label: 'cl.hhr.syslab-tunnel', args: [binary, 'http', `http://127.0.0.1:${config.port}`, '--url', url.origin, '--inspect=false'] });
}
for (const { label, args } of jobs) {
  const file = path.join(agents, label + '.plist');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(path.join(root, 'logs', label + '.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(root, 'logs', label + '.error.log'))}</string>
</dict></plist>`;
  fs.writeFileSync(file, plist, { mode: 0o600 });
  const domain = `gui/${process.getuid()}`;
  try { execFileSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch {}
  execFileSync('/bin/launchctl', ['bootstrap', domain, file], { stdio: 'inherit' });
  console.log(`Instalado ${label}. Para detenerlo: launchctl bootout ${domain}/${label}`);
}
console.log('Arranque al iniciar sesión de este usuario. Después de reiniciar/FileVault debes iniciar sesión. No permite encender un Mac apagado.');
