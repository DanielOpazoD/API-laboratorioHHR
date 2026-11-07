const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JobStore } = require('../services/jobStore');

test('a second server on an occupied port never recovers or rewrites the first server queue', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hhr-startup-'));
  const store = new JobStore(path.join(directory, 'state'));
  store.save({ version: 1, jobs: { synthetic: { status: 'running' } }, inbox: {} });
  const before = fs.readFileSync(store.file);
  const listener = http.createServer().listen(0, '127.0.0.1');
  await new Promise(resolve => listener.on('listening', resolve));
  let child;
  try {
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SYSLAB_')));
    child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], {
      cwd: directory, stdio: 'ignore', env: { ...cleanEnv,
        HOST: '127.0.0.1', PORT: String(listener.address().port),
        SYSLAB_API_TOKEN: 'synthetic-token'.repeat(4), SYSLAB_USER: 'synthetic', SYSLAB_PASS: 'synthetic',
        SYSLAB_BASE_URL: 'http://127.0.0.1:9/syslab/', SYSLAB_STATE_DIR: path.join(directory, 'state'),
      },
    });
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup did not exit')), 5_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    expect(exit).toBe(1);
    expect(fs.readFileSync(store.file)).toEqual(before);
    expect(store.load().jobs.synthetic.status).toBe('running');
  } finally {
    if (child && child.exitCode === null) child.kill();
    await new Promise(resolve => listener.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);
