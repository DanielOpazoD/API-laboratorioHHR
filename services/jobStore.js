const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');

/** Local clinical work is encrypted at rest; credentials can rotate without losing the queue. */
class JobStore {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    this.file = path.join(directory, 'laboratory.enc');
    const keyFile = path.join(directory, 'laboratory.key');
    if (!fs.existsSync(keyFile)) {
      if (fs.existsSync(this.file)) throw new Error('Falta la clave de la cola existente.');
      fs.writeFileSync(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
    }
    this.key = fs.readFileSync(keyFile);
    if (this.key.length !== 32) throw new Error('Clave de cola no válida.');
    fs.chmodSync(keyFile, 0o600);
  }

  load() {
    if (!fs.existsSync(this.file)) return { version: 1, jobs: {}, inbox: {} };
    const bytes = fs.readFileSync(this.file);
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
    if (state.version !== 1 || !state.jobs || !state.inbox) throw new Error('Cola no reconocida.');
    return state;
  }

  save(state) {
    const plain = Buffer.from(JSON.stringify(state));
    // Refuse additional work rather than silently removing confirmed or pending clinical work.
    if (plain.length > 64 * 1024 * 1024) throw new Error('La cola requiere mantenimiento.');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const temporary = this.file + '.tmp';
    const fd = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(fd, Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.file);
    const directoryFd = fs.openSync(this.directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  }
}

module.exports = { JobStore };
