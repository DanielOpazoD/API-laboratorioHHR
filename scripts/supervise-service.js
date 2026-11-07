const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { RecoverySupervisor } = require('../services/recoverySupervisor');

const probeLive = async (url, token, timeoutMs = 4_000, fetchImpl = fetch) => {
  try {
    const response = await fetchImpl(url, { redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(timeoutMs) });
    if ([401, 403].includes(response.status)) return 'authentication-required';
    if (!response.ok) return 'unreachable';
    const body = await response.json();
    return body.success === true && body.service === 'syslab-scraper'
      ? 'healthy' : 'unreachable';
  } catch { return 'unreachable'; }
};

const createProbe = ({ component, port, proxyUrl, token, check = probeLive }) => async () => {
  const local = await check(`http://127.0.0.1:${port}/live`, token);
  if (component === 'server' || local === 'authentication-required') return local;
  if (local !== 'healthy') return 'dependency-unavailable';
  return check(`${proxyUrl}/live`, token, 10_000);
};

const terminate = child => new Promise(resolve => {
  if (!child || child.exitCode !== null || child.signalCode != null || child.spawnFailed) return resolve();
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 15_000);
  child.once('exit', () => { clearTimeout(timer); resolve(); });
  child.kill('SIGTERM');
});

async function main() {
  const component = process.argv[2];
  if (!['server', 'tunnel'].includes(component)) throw new Error('Componente no válido.');
  const config = require('../config/env');
  const logger = require('../utils/logger');
  if (config.apiToken.length < 32) throw new Error('Completa la configuración local.');
  const proxyUrl = process.env.SYSLAB_PROXY_URL;
  if (component === 'tunnel') {
    const url = new URL(proxyUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ngrok-free.dev') ||
        url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Dominio de túnel no válido.');
    }
  }
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'logs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `recovery-${component}.json`);
  let history = [];
  try { history = JSON.parse(fs.readFileSync(file, 'utf8')).starts || []; } catch {}
  if (!Array.isArray(history)) history = [];
  let previousState;
  const supervisor = new RecoverySupervisor({
    history,
    threshold: component === 'tunnel' ? 6 : 3,
    launch: () => {
      const binary = component === 'server' ? process.execPath : process.env.HHR_NGROK_BINARY;
      const args = component === 'server' ? [path.join(root, 'server.js')]
        : ['http', `http://127.0.0.1:${config.port}`, '--url', new URL(proxyUrl).origin,
          '--config', process.env.HHR_NGROK_CONFIG, '--inspect=false'];
      const child = spawn(binary, args, { cwd: root, stdio: 'ignore', env: process.env });
      child.once('error', () => { child.spawnFailed = true; });
      return child;
    },
    terminate,
    probe: createProbe({ component, port: config.port, proxyUrl, token: config.apiToken }),
    save: state => {
      const temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(temp, file);
      if (state.state !== previousState) logger.info(`Recuperación ${component}: ${state.state}`);
      previousState = state.state;
    },
  });
  let timer;
  const run = async () => {
    await supervisor.tick();
    if (!supervisor.stopped) timer = setTimeout(run, 30_000);
  };
  const stop = async () => {
    clearTimeout(timer);
    await supervisor.stop();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await run();
}

if (require.main === module) main().catch(() => {
  console.error('No se pudo iniciar la supervisión. Revisa la configuración local.');
  process.exitCode = 1;
});
module.exports = { probeLive, createProbe, terminate };
