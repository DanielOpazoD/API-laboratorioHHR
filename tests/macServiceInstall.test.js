const platform = Object.getOwnPropertyDescriptor(process, 'platform');
const previousUser = process.env.SUDO_USER;
const previousRoot = process.env.HHR_INSTALL_ROOT;
const originalArgv = [...process.argv];

afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  if (previousUser === undefined) delete process.env.SUDO_USER; else process.env.SUDO_USER = previousUser;
  if (previousRoot === undefined) delete process.env.HHR_INSTALL_ROOT; else process.env.HHR_INSTALL_ROOT = previousRoot;
  jest.restoreAllMocks(); jest.resetModules(); jest.dontMock('node:fs'); jest.dontMock('node:child_process');
  process.argv = [...originalArgv];
});

const setup = (failTunnel = false, userScope = false) => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  process.env.SUDO_USER = 'synthetic';
  process.env.HHR_INSTALL_ROOT = '/Users/synthetic/HHR-laboratorio';
  jest.spyOn(process, 'getuid').mockReturnValue(userScope ? 501 : 0);
  jest.spyOn(require('node:os'), 'userInfo').mockReturnValue({ username: 'synthetic' });
  if (userScope) process.argv.push('--user');
  const files = new Map([
    ['/Users/synthetic/HHR-laboratorio/.env', 'SYSLAB_USER=synthetic\nSYSLAB_PASS=synthetic\nSYSLAB_API_TOKEN=' + 'synthetic'.repeat(8) + '\nSYSLAB_PROXY_URL=https://synthetic.ngrok-free.dev\nHOST=127.0.0.1'],
    ['/opt/homebrew/bin/ngrok', 'binary'],
    ['/Users/synthetic/Library/Application Support/ngrok/ngrok.yml', 'private'],
    ['/Users/synthetic/Library/LaunchAgents/cl.hhr.syslab.plist', 'old-server-agent'],
    ['/Users/synthetic/Library/LaunchAgents/cl.hhr.syslab-tunnel.plist', 'old-tunnel-agent'],
  ]);
  const loaded = new Set(['gui/501/cl.hhr.syslab', 'gui/501/cl.hhr.syslab-tunnel']);
  const execFileSync = jest.fn((binary, args) => {
    if (binary.endsWith('/id')) return '501\n';
    if (binary.endsWith('/dscl')) return 'NFSHomeDirectory: /Users/synthetic\n';
    if (binary.endsWith('/launchctl')) {
      if (args[0] === 'print' && !loaded.has(args[1])) throw new Error('not loaded');
      if (args[0] === 'bootout') loaded.delete(args[1]);
      if (args[0] === 'bootstrap') {
        if (failTunnel && args[1] === 'system' && args[2].endsWith('cl.hhr.syslab-tunnel.plist')) throw new Error('synthetic failure');
        const label = args[2].split('/').at(-1).replace('.plist', '');
        loaded.add(`${args[1]}/${label}`);
      }
    }
    return '';
  });
  const fs = {
    existsSync: file => files.has(file),
    lstatSync: () => ({ uid: 501, mode: 0o600, isFile: () => true, isSymbolicLink: () => false }),
    statSync: () => ({ isFile: () => true }),
    readFileSync: file => Buffer.from(files.get(file)),
    writeFileSync: (file, body) => files.set(file, body),
    mkdirSync: jest.fn(), chmodSync: jest.fn(), chownSync: jest.fn(),
    renameSync: (from, to) => { if (!files.has(from)) throw new Error('missing'); files.set(to, files.get(from)); files.delete(from); },
    copyFileSync: (from, to) => files.set(to, files.get(from)),
  };
  jest.doMock('node:fs', () => fs);
  jest.doMock('node:child_process', () => ({ execFileSync }));
  const { install } = require('../scripts/install-mac-services');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  return { install, files, loaded, execFileSync };
};

test('migrates only the two owned jobs and enables recovery of power without touching FileVault or SSH', () => {
  const h = setup(); h.install();
  expect(h.loaded).toEqual(new Set(['system/cl.hhr.syslab', 'system/cl.hhr.syslab-tunnel']));
  expect(h.execFileSync).toHaveBeenCalledWith('/usr/bin/pmset', ['-a', 'autorestart', '1'], expect.any(Object));
  const commands = h.execFileSync.mock.calls.map(([binary]) => binary);
  expect(commands.some(c => /fdesetup|dseditgroup|systemsetup/.test(c))).toBe(false);
  expect(h.files.get('/Library/LaunchDaemons/cl.hhr.syslab.plist')).toContain('<key>UserName</key><string>synthetic</string>');
});

test('on partial installation failure removes new boot definitions and restores the former agents', () => {
  const h = setup(true);
  expect(() => h.install()).toThrow('se intentó restaurar');
  expect(h.loaded).toEqual(new Set(['gui/501/cl.hhr.syslab', 'gui/501/cl.hhr.syslab-tunnel']));
  expect(h.files.has('/Library/LaunchDaemons/cl.hhr.syslab.plist')).toBe(false);
  expect(h.files.has('/Library/LaunchDaemons/cl.hhr.syslab-tunnel.plist')).toBe(false);
  expect(h.files.get('/Users/synthetic/Library/LaunchAgents/cl.hhr.syslab.plist')).toBe('old-server-agent');
  expect(h.execFileSync.mock.calls.some(([binary]) => binary.endsWith('/pmset'))).toBe(false);
});
test('installs supervised user agents without admin authorization or changing energy', () => {
  const h = setup(false, true); h.install();
  expect(h.loaded).toEqual(new Set(['gui/501/cl.hhr.syslab', 'gui/501/cl.hhr.syslab-tunnel']));
  expect(h.files.get('/Users/synthetic/Library/LaunchAgents/cl.hhr.syslab.plist')).not.toContain('<key>UserName');
  expect(h.execFileSync.mock.calls.some(([binary]) => binary.endsWith('/pmset'))).toBe(false);
  expect(h.files.has('/Library/LaunchDaemons/cl.hhr.syslab.plist')).toBe(false);
});
