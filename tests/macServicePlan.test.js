const { buildServicePlan } = require('../scripts/mac-service-plan');
const input = { root: '/Users/synthetic/HHR-laboratorio', home: '/Users/synthetic',
  username: 'synthetic', uid: 501, node: '/opt/node/bin/node', ngrok: '/opt/homebrew/bin/ngrok' };

test('both jobs start at boot under the unprivileged user with explicit home and browser paths', () => {
  const jobs = buildServicePlan(input);
  expect(jobs.map(j => j.label)).toEqual(['cl.hhr.syslab', 'cl.hhr.syslab-tunnel']);
  for (const job of jobs) {
    expect(job.plist).toContain('<key>UserName</key><string>synthetic</string>');
    expect(job.plist).toContain('<key>KeepAlive</key><true/>');
    expect(job.plist).toContain('<key>RunAtLoad</key><true/>');
    expect(job.plist).toContain('/Users/synthetic/Library/Caches/ms-playwright');
    expect(job.plist).not.toMatch(/PASSWORD|API_TOKEN|authtoken|fdesetup|autoLoginUser/);
  }
});

test.each([
  { username: 'root' }, { uid: 0 }, { root: '/Users/synthetic/Documents/server' },
  { root: '/other/server' }, { node: 'node' }, { username: 'injected\nvalue' },
])('rejects a privileged user or unsafe path: %j', changed => {
  expect(() => buildServicePlan({ ...input, ...changed })).toThrow();
});

test('escapes paths in valid plist XML without including secrets', () => {
  const [job] = buildServicePlan({ ...input, root: '/Users/synthetic/server & helpers' });
  expect(job.plist).toContain('server &amp; helpers');
});
test('the user-only fallback has the same supervisors without system-user directives', () => {
  for (const job of buildServicePlan({ ...input, scope: 'user' })) {
    expect(job.plist).not.toMatch(/<key>UserName|<key>GroupName/);
    expect(job.args).toContain('/Users/synthetic/HHR-laboratorio/scripts/supervise-service.js');
  }
});
