/** Install system jobs running as the existing user, never as root. No passwords accepted. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { buildServicePlan } = require('./mac-service-plan');

// bootout can return before launchd releases its registration. Retry only that
// transient bootstrap error, including when restoring the previous definition.
function runCommand(binary, args, execute = execFileSync,
  pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)) {
  for (let attempt = 0; ; attempt++) {
    try { return execute(binary, args, { stdio: 'ignore' }); }
    catch (error) {
      if (binary !== '/bin/launchctl' || args[0] !== 'bootstrap' || error.status !== 5 || attempt >= 12) throw error;
      pause();
    }
  }
}

function install() {
  if (process.platform !== 'darwin') throw new Error('Este instalador requiere macOS.');
  const prepare = process.argv.includes('--prepare');
  const userScope = process.argv.includes('--user');
  if (userScope && process.getuid() === 0) throw new Error('El servicio de usuario se instala sin sudo.');
  const sourceRoot = path.resolve(__dirname, '..');
  const root = process.env.HHR_INSTALL_ROOT || sourceRoot;
  const username = process.getuid() === 0 ? process.env.SUDO_USER : os.userInfo().username;
  if (!username) throw new Error('Ejecuta sudo desde tu usuario habitual.');
  if (!/^[a-z_][a-z0-9_.-]*$/i.test(username) || username === 'root') throw new Error('Ejecuta sudo desde tu usuario habitual.');
  const uid = Number(execFileSync('/usr/bin/id', ['-u', username], { encoding: 'utf8' }).trim());
  const home = execFileSync('/usr/bin/dscl', ['.', '-read', `/Users/${username}`, 'NFSHomeDirectory'], { encoding: 'utf8' })
    .replace(/^NFSHomeDirectory:\s*/, '').trim();
  const ngrok = ['/opt/homebrew/bin/ngrok', '/usr/local/bin/ngrok'].find(file => fs.existsSync(file));
  if (!ngrok) throw new Error('Instala ngrok antes de preparar los servicios.');
  const jobs = buildServicePlan({ root, home, username, uid, node: process.execPath, ngrok, scope: userScope ? 'user' : 'system' });
  const envFile = path.join(root, '.env');
  const envStat = fs.lstatSync(envFile);
  if (!envStat.isFile() || envStat.isSymbolicLink() || envStat.uid !== uid || (envStat.mode & 0o077)) {
    throw new Error('.env debe pertenecer al usuario y tener permiso 600.');
  }
  const values = require('dotenv').parse(fs.readFileSync(envFile));
  const decode = (key, plain) => values[key] === undefined ? values[plain] || '' : Buffer.from(values[key], 'base64').toString();
  if (decode('SYSLAB_API_TOKEN_BASE64', 'SYSLAB_API_TOKEN').length < 32 ||
      !decode('SYSLAB_USER_BASE64', 'SYSLAB_USER') || !decode('SYSLAB_PASS_BASE64', 'SYSLAB_PASS')) {
    throw new Error('Completa la configuración privada local.');
  }
  const url = new URL(values.SYSLAB_PROXY_URL);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ngrok-free.dev') || url.pathname !== '/' ||
      url.username || url.password || url.port || url.search || url.hash) throw new Error('Dominio ngrok no válido.');
  if (values.HOST && values.HOST !== '127.0.0.1') throw new Error('El servidor debe escuchar exclusivamente en loopback.');
  const ngrokConfig = path.join(home, 'Library/Application Support/ngrok/ngrok.yml');
  const tokenStat = fs.lstatSync(ngrokConfig);
  if (!tokenStat.isFile() || tokenStat.isSymbolicLink() || tokenStat.uid !== uid || (tokenStat.mode & 0o077)) {
    throw new Error('La configuración privada de ngrok debe pertenecer al usuario y tener permiso 600.');
  }
  const prepared = path.join(sourceRoot, 'logs/prepared-services');
  fs.mkdirSync(prepared, { recursive: true, mode: 0o700 });
  if (process.getuid() === 0) fs.chownSync(prepared, uid, 20);
  for (const job of jobs) {
    const file = path.join(prepared, job.label + '.plist');
    fs.writeFileSync(file, job.plist, { mode: 0o600 });
    if (process.getuid() === 0) fs.chownSync(file, uid, 20);
    execFileSync('/usr/bin/plutil', ['-lint', file], { stdio: 'ignore' });
  }
  if (prepare) {
    console.log(`Plan validado. Dos servicios ${userScope ? 'de usuario' : 'system'}; FileVault y SSH sin cambios.`);
    return;
  }
  if (!userScope && process.getuid() !== 0) throw new Error('Instalación preparada: ejecútala con sudo para autorizar servicios y recuperación de energía.');
  for (const file of ['scripts/supervise-service.js', 'services/recoverySupervisor.js', 'server.js']) {
    if (!fs.statSync(path.join(root, file)).isFile()) throw new Error('Actualiza el servidor antes de instalar.');
  }
  const backup = path.join(root, 'logs', `before-system-services-${Date.now()}`);
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  if (!userScope) fs.chownSync(backup, uid, 20);
  const command = runCommand;
  const loaded = domain => {
    try { command('/bin/launchctl', ['print', domain]); return true; } catch { return false; }
  };
  if (userScope && jobs.some(job => loaded(`system/${job.label}`))) {
    throw new Error('Ya existe un servicio del sistema; no se duplicará.');
  }
  const movedAgents = [];
  const oldSystem = [];
  const started = [];
  const written = [];
  try {
    for (const job of jobs) {
      const userDomain = `gui/${uid}/${job.label}`;
      if (loaded(userDomain)) command('/bin/launchctl', ['bootout', userDomain]);
      const agent = path.join(home, 'Library/LaunchAgents', job.label + '.plist');
      if (fs.existsSync(agent)) {
        const saved = path.join(backup, job.label + '.agent.plist');
        fs.renameSync(agent, saved);
        movedAgents.push({ agent, saved });
      }
      const systemDomain = `system/${job.label}`;
      if (userScope) {
        fs.writeFileSync(agent, job.plist, { mode: 0o600 });
        written.push(agent);
        command('/bin/launchctl', ['bootstrap', `gui/${uid}`, agent]);
        started.push({ label: job.label, target: agent });
        continue;
      }
      if (loaded(systemDomain)) command('/bin/launchctl', ['bootout', systemDomain]);
      const target = path.join('/Library/LaunchDaemons', job.label + '.plist');
      if (fs.existsSync(target)) {
        if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Se rechazó una ruta de servicio enlazada.');
        const saved = path.join(backup, job.label + '.system.plist');
        fs.copyFileSync(target, saved);
        oldSystem.push({ target, saved });
      }
      fs.writeFileSync(target, job.plist, { mode: 0o644 });
      written.push(target);
      fs.chownSync(target, 0, 0);
      fs.chmodSync(target, 0o644);
      command('/bin/launchctl', ['enable', systemDomain]);
      command('/bin/launchctl', ['bootstrap', 'system', target]);
      started.push({ label: job.label, target });
    }
    if (!userScope) command('/usr/bin/pmset', ['-a', 'autorestart', '1']);
  } catch {
    for (const job of started) {
      try { command('/bin/launchctl', ['bootout', `${userScope ? `gui/${uid}` : 'system'}/${job.label}`]); } catch {}
    }
    for (const target of written) fs.renameSync(target, path.join(backup, path.basename(target) + '.failed'));
    for (const { target, saved } of oldSystem) {
      fs.copyFileSync(saved, target);
      try { command('/bin/launchctl', ['bootstrap', 'system', target]); } catch {}
    }
    for (const { agent, saved } of movedAgents) {
      fs.renameSync(saved, agent);
      try { command('/bin/launchctl', ['bootstrap', `gui/${uid}`, agent]); } catch {}
    }
    throw new Error('Instalación incompleta; se intentó restaurar los servicios anteriores. Revisa launchctl antes de reiniciar.');
  }
  console.log(userScope ? 'Supervisión de usuario instalada. Requiere iniciar sesión tras reiniciar; energía sin cambios.'
    : 'Servicios system instalados sin privilegios de root para el proceso. Recuperación de energía activada. FileVault conservado.');
  console.log('El disco debe desbloquearse después de un arranque en frío. No se ha reiniciado el Mac.');
}

if (require.main === module) {
  try { install(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { install, runCommand };
