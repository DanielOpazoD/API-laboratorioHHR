const path = require('node:path');
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const buildServicePlan = ({ root, home, username, uid, node, ngrok }) => {
  if (!/^[a-z_][a-z0-9_.-]*$/i.test(username) || username === 'root' || !Number.isInteger(uid) || uid < 1) {
    throw new Error('Los servicios deben ejecutarse como usuario sin privilegios.');
  }
  for (const value of [root, home, node, ngrok]) {
    if (!path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw new Error('Ruta absoluta no válida.');
  }
  const relative = path.relative(home, root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
      /^(Documents|Desktop|Downloads)(\/|$)/.test(relative)) {
    throw new Error('Instala primero en una carpeta estable del usuario fuera de Documentos/Escritorio/Descargas.');
  }
  const environment = { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    PLAYWRIGHT_BROWSERS_PATH: path.join(home, 'Library/Caches/ms-playwright'),
    HHR_NGROK_BINARY: ngrok,
    HHR_NGROK_CONFIG: path.join(home, 'Library/Application Support/ngrok/ngrok.yml') };
  return ['server', 'tunnel'].map(component => {
    const label = component === 'server' ? 'cl.hhr.syslab' : 'cl.hhr.syslab-tunnel';
    const args = ['/usr/bin/caffeinate', '-i', node, path.join(root, 'scripts/supervise-service.js'), component];
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>UserName</key><string>${xml(username)}</string>
<key>GroupName</key><string>staff</string>
<key>ProgramArguments</key><array>${args.map(v => `<string>${xml(v)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(environment).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ExitTimeOut</key><integer>30</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>`;
    return { label, component, plist, args };
  });
};
module.exports = { buildServicePlan };
