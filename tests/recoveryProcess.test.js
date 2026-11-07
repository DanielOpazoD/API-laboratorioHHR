const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { RecoverySupervisor } = require('../services/recoverySupervisor');
const { probeLive, terminate } = require('../scripts/supervise-service');

test('recovers an actual crashed and then unresponsive subprocess without replaying work', async () => {
  let time = 100_000, port, ready;
  const launch = jest.fn(() => {
    const child = fork(path.join(__dirname, 'fixtures/recovery-server.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    ready = once(child, 'message').then(([message]) => { port = message.port; });
    return child;
  });
  const supervisor = new RecoverySupervisor({ launch, now: () => time, graceMs: 0,
    intervalMs: 10, threshold: 2,
    probe: () => probeLive(`http://127.0.0.1:${port}/live`, 'synthetic', 100), terminate });
  try {
    await supervisor.tick(); await ready;
    await supervisor.tick(); expect(supervisor.state).toBe('healthy');
    let exited = once(supervisor.child, 'exit');
    supervisor.child.kill('SIGKILL'); await exited;
    time += 20; await supervisor.tick(); await ready;
    expect(launch).toHaveBeenCalledTimes(2);
    const changed = once(supervisor.child, 'message');
    supervisor.child.send({ hang: true }); await changed;
    time += 20; await supervisor.tick(); await supervisor.tick();
    expect(supervisor.child).toBeNull();
    time += 20; await supervisor.tick(); await ready;
    await supervisor.tick(); expect(supervisor.state).toBe('healthy');
    expect(launch).toHaveBeenCalledTimes(3);
  } finally { await supervisor.stop(); }
}, 10_000);
