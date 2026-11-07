const { RecoverySupervisor } = require('../services/recoverySupervisor');
const { createProbe, probeLive } = require('../scripts/supervise-service');

const harness = (options = {}) => {
  let time = 100_000;
  const launch = jest.fn(() => ({ pid: 123, exitCode: null }));
  const probe = jest.fn(async () => 'healthy');
  const terminate = jest.fn(async child => { child.exitCode = 0; });
  const save = jest.fn();
  const supervisor = new RecoverySupervisor({ launch, probe, terminate, save,
    now: () => time, graceMs: 0, ...options });
  return { supervisor, launch, probe, terminate, save, advance: milliseconds => { time += milliseconds; } };
};

test('recovers a crashed child with backoff, preserving its restart budget across supervisor restarts', async () => {
  const h = harness();
  await h.supervisor.tick();
  h.supervisor.child.exitCode = 1;
  await h.supervisor.tick();
  expect(h.launch).toHaveBeenCalledTimes(1);
  h.advance(30_000);
  await h.supervisor.tick();
  expect(h.launch).toHaveBeenCalledTimes(2);
  const history = h.supervisor.snapshot().starts;
  const recovered = harness({ history, now: () => 130_000 });
  await recovered.supervisor.tick();
  expect(recovered.launch).not.toHaveBeenCalled();
  expect(recovered.supervisor.snapshot().starts).toEqual(history);
});

test('stops repeated launches and retries when the durable budget window expires', async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) {
    await h.supervisor.tick();
    h.supervisor.child.exitCode = 1;
    h.advance(30_000);
  }
  await h.supervisor.tick();
  expect(h.launch).toHaveBeenCalledTimes(3);
  expect(h.supervisor.state).toBe('backoff');
  h.advance(15 * 60_000);
  await h.supervisor.tick();
  expect(h.launch).toHaveBeenCalledTimes(4);
});

test('requires consecutive failures and recovers a hung process without replaying a request', async () => {
  const h = harness();
  await h.supervisor.tick();
  h.probe.mockResolvedValue('unreachable');
  await h.supervisor.tick(); await h.supervisor.tick();
  expect(h.terminate).not.toHaveBeenCalled();
  h.probe.mockResolvedValueOnce('healthy');
  await h.supervisor.tick();
  expect(h.supervisor.failures).toBe(0);
  await h.supervisor.tick(); await h.supervisor.tick(); await h.supervisor.tick();
  expect(h.terminate).toHaveBeenCalledTimes(1);
  h.advance(30_000);
  await h.supervisor.tick();
  expect(h.launch).toHaveBeenCalledTimes(2);
});

test.each(['dependency-unavailable', 'authentication-required'])('does not restart for %s', async result => {
  const h = harness(); await h.supervisor.tick(); h.probe.mockResolvedValue(result);
  for (let i = 0; i < 10; i++) await h.supervisor.tick();
  expect(h.terminate).not.toHaveBeenCalled();
});

test('does not overlap slow checks, and shutdown cannot start another child', async () => {
  const h = harness(); await h.supervisor.tick();
  let finish;
  h.probe.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = h.supervisor.tick();
  await h.supervisor.tick();
  expect(h.probe).toHaveBeenCalledTimes(1);
  await h.supervisor.stop(); finish('unreachable'); await pending;
  await h.supervisor.tick();
  expect(h.launch).toHaveBeenCalledTimes(1);
  expect(h.supervisor.state).toBe('stopped');
});

test('a failed local server prevents tunnel restart; WAN recovery is observed independently of Syslab', async () => {
  const check = jest.fn().mockResolvedValueOnce('unreachable').mockResolvedValue('healthy');
  const probe = createProbe({ component: 'tunnel', port: 3100,
    proxyUrl: 'https://synthetic.ngrok-free.dev', token: 'synthetic', check });
  expect(await probe()).toBe('dependency-unavailable');
  expect(check).toHaveBeenCalledTimes(1);
  expect(await probe()).toBe('healthy');
  expect(check.mock.calls.map(c => c[0])).toEqual(expect.not.arrayContaining([expect.stringContaining('/health')]));
  expect(check).toHaveBeenLastCalledWith('https://synthetic.ngrok-free.dev/live', 'synthetic', 10_000);
});

test('liveness verifies JSON and authentication rather than accepting a proxy error or redirect', async () => {
  const request = jest.fn().mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ success: true, service: 'syslab-scraper' }) });
  expect(await probeLive('http://127.0.0.1/live', 'synthetic', 1000, request)).toBe('healthy');
  expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  request.mockResolvedValue({ ok: false, status: 401 });
  expect(await probeLive('http://127.0.0.1/live', 'synthetic', 1000, request)).toBe('authentication-required');
  request.mockResolvedValue({ ok: true, status: 200, json: async () => ({ connected: true }) });
  expect(await probeLive('http://127.0.0.1/live', 'synthetic', 1000, request)).toBe('unreachable');
});
