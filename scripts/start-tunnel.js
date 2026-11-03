require('../config/env');
const { spawnSync } = require('node:child_process');
const url = process.env.SYSLAB_PROXY_URL;
if (!url || new URL(url).protocol !== 'https:') throw new Error('Configura tu SYSLAB_PROXY_URL HTTPS.');
const result = spawnSync('ngrok', ['http', `http://127.0.0.1:${process.env.PORT || 3100}`, '--url', url, '--inspect=false'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
