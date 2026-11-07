/** Bounded process recovery. No clinical requests are replayed. */
class RecoverySupervisor {
  constructor({ launch, probe, terminate, save = () => {}, now = Date.now,
    history = [], threshold = 3, intervalMs = 30_000, graceMs = 60_000,
    windowMs = 15 * 60_000, maxStarts = 3 }) {
    Object.assign(this, { launch, probe, terminate, save, now, threshold, intervalMs,
      graceMs, windowMs, maxStarts });
    this.history = history.filter(t => Number.isFinite(t) && t <= now()).slice(-maxStarts);
    this.child = null;
    this.failures = 0;
    this.stopped = false;
    this.running = false;
    this.state = 'starting';
  }

  snapshot() {
    return { state: this.state, failures: this.failures, starts: [...this.history],
      childPid: this.child?.pid || null, checkedAt: this.now() };
  }

  async tick() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      const now = this.now();
      this.history = this.history.filter(t => now - t < this.windowMs);
      if (!this.child || this.child.exitCode !== null || this.child.signalCode != null || this.child.spawnFailed) {
        this.child = null;
        if (this.history.length >= this.maxStarts ||
            (this.history.length && now - this.history.at(-1) < this.intervalMs)) {
          this.state = 'backoff';
          return;
        }
        this.history.push(now); // Persist before starting: a supervisor crash cannot reset the budget.
        this.state = 'starting';
        this.save(this.snapshot());
        this.child = this.launch();
        this.failures = 0;
        return;
      }
      if (now - this.history.at(-1) < this.graceMs) return;
      let result;
      try { result = await this.probe(); } catch { result = 'unreachable'; }
      if (this.stopped) return;
      this.state = result;
      // A failed dependency or credential requires recovery there, not a tunnel restart loop.
      if (['healthy', 'dependency-unavailable', 'authentication-required'].includes(result)) {
        this.failures = 0;
        return;
      }
      if (++this.failures < this.threshold) return;
      this.state = 'restarting';
      await this.terminate(this.child);
      this.child = null;
      this.failures = 0;
    } finally {
      this.save(this.snapshot());
      this.running = false;
    }
  }

  async stop() {
    this.stopped = true;
    this.state = 'stopped';
    if (this.child) await this.terminate(this.child);
    this.child = null;
    this.save(this.snapshot());
  }
}

module.exports = { RecoverySupervisor };
