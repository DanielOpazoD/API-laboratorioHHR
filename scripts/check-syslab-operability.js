const config = require('../config/env');

const DEFAULT_PUBLIC_PROXY_URL = 'https://hyperkalemic-transthoracic-lecia.ngrok-free.dev';

const timeoutSignal = timeoutMs => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
};

const checkUrl = async (label, url, options = {}) => {
  const { signal, clear } = timeoutSignal(options.timeoutMs || 5_000);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      signal,
      headers: {
        'ngrok-skip-browser-warning': 'true',
        ...(options.headers || {}),
      },
    });
    clear();
    return {
      label,
      url,
      required: options.required !== false,
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    clear();
    return {
      label,
      url,
      required: options.required !== false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const main = async () => {
  const port = process.env.PORT || config.port || 3000;
  const publicProxyUrl = (process.env.SYSLAB_PROXY_URL || DEFAULT_PUBLIC_PROXY_URL).replace(
    /\/+$/,
    ''
  );
  const syslabBaseUrl = config.syslab.baseUrl.replace(/\/+$/, '/');

  const checks = await Promise.all([
    checkUrl('scraper-local-health', `http://localhost:${port}/health`),
    checkUrl('syslab-interno-directo-orientativo', syslabBaseUrl, {
      required: false,
      timeoutMs: 3_000,
    }),
    checkUrl('tunel-publico-health', `${publicProxyUrl}/health`),
  ]);

  console.log('Syslab Scraper operability check');
  console.log('--------------------------------');
  for (const check of checks) {
    const status = check.ok ? 'OK' : check.required ? 'FAIL' : 'WARN';
    const detail = check.error ? check.error : `HTTP ${check.status}`;
    console.log(`[${status}] ${check.label}: ${check.url} (${detail})`);
  }

  const failed = checks.filter(check => check.required && !check.ok);
  if (failed.length > 0) {
    console.log('');
    console.log('Interpretacion rapida:');
    console.log('- Falla scraper-local-health: node server.js no esta corriendo o usa otro puerto.');
    console.log('- Falla tunel-publico-health: ngrok/cloudflared esta apagado o mal apuntado.');
    process.exitCode = 1;
  }

  const advisoryFailed = checks.some(check => !check.required && !check.ok);
  if (advisoryFailed) {
    console.log('');
    console.log(
      'Nota: el acceso directo a Syslab puede fallar desde curl/fetch aunque Playwright funcione. ' +
        'Si local y tunel estan OK, valida el flujo real con /api/exams?rut=<rut_de_prueba>.'
    );
  }
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
