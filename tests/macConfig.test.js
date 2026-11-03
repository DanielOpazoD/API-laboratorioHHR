const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeMacConfig } = require('../scripts/write-mac-config');
test('the saved configuration preserves special characters exactly through dotenv and config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syslab-config-'));
  try {
    const values = { syslab_user: 'synthetic-user', syslab_pass: 'synthetic"\\\\n\'`# value', syslab_token: 'test'.repeat(16), syslab_url: 'https://example.ngrok-free.dev' };
    const file = path.join(dir, '.env');
    writeMacConfig(file, values);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const script = `const config = require(${JSON.stringify(path.resolve(__dirname, '../config/env'))}); process.stdout.write(JSON.stringify([config.syslab.user, config.syslab.pass, config.apiToken]));`;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^SYSLAB_/.test(key)) delete env[key];
    const loaded = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: dir, env, encoding: 'utf8' }));
    expect(loaded).toEqual([values.syslab_user, values.syslab_pass, values.syslab_token]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('interactive setup preserves password whitespace and quotes through a real terminal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syslab-prompt-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    for (const file of ['configure-mac.sh', 'write-mac-config.js']) fs.copyFileSync(path.resolve(__dirname, '../scripts', file), path.join(dir, 'scripts', file));
    fs.copyFileSync(path.resolve(__dirname, '../.env.example'), path.join(dir, '.env.example'));
    const password = [' ', 'sample', '"', String.fromCharCode(92), 'n', String.fromCharCode(39), '`# value '].join('');
    const token = 'test'.repeat(16);
    const program = `
import json,os,pty,select,subprocess,sys,time
master,slave=pty.openpty()
proc=subprocess.Popen(['bash',sys.argv[1]],stdin=slave,stdout=slave,stderr=slave)
os.close(slave)
buffer=b''
for prompt,value in zip(['Usuario Syslab:', 'Contrase', 'Clave compartida', 'Dominio HTTPS'],json.loads(sys.argv[2])):
 deadline=time.monotonic()+10
 while prompt.encode() not in buffer:
  if time.monotonic()>deadline: raise RuntimeError('No se recibió el prompt esperado')
  if select.select([master],[],[],0.1)[0]: buffer+=os.read(master,4096)
 buffer=b''
 os.write(master,(value+'\\n').encode())
if proc.wait(timeout=10)!=0: raise RuntimeError('Falló el configurador')
os.close(master)
`;
    execFileSync('python3', ['-c', program, path.join(dir, 'scripts/configure-mac.sh'), JSON.stringify(['synthetic', password, token, 'https://example.ngrok-free.dev'])], { stdio: 'pipe' });
    const values = require('dotenv').parse(fs.readFileSync(path.join(dir, '.env')));
    expect(Buffer.from(values.SYSLAB_PASS_BASE64, 'base64').toString()).toBe(password);
    expect(Buffer.from(values.SYSLAB_API_TOKEN_BASE64, 'base64').toString()).toBe(token);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}, 20_000);
