import { fork, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PETFISH_DIR = path.join(os.homedir(), '.petfish');
const PID_FILE = path.join(PETFISH_DIR, 'connector.pid');
const LOG_FILE = path.join(PETFISH_DIR, 'connector.log');
const STABLE_THRESHOLD_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60_000;

function ensureDir() {
  fs.mkdirSync(PETFISH_DIR, { recursive: true });
}

function writePid(pid: number) {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removePid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch { /* ignore */ }
}

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  process.stdout.write(line);
}

export function daemonStart(configPath: string): void {
  const existingPid = readPid();
  if (existingPid && isAlive(existingPid)) {
    console.log(`Connector already running (PID ${existingPid})`);
    process.exit(0);
  }

  ensureDir();
  const child = fork(process.argv[1]!, ['--supervisor', configPath, '--log-file', LOG_FILE], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PETFISH_DAEMON: '1' },
  });

  if (!child.pid) {
    console.error('Failed to fork supervisor');
    process.exit(1);
  }

  writePid(child.pid);
  child.unref();
  console.log(`Connector started (PID ${child.pid})`);
  console.log(`Log: ${LOG_FILE}`);
  process.exit(0);
}

export function daemonStop(): void {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    console.log('Connector is not running');
    removePid();
    process.exit(0);
  }

  process.kill(pid, 'SIGTERM');
  console.log(`Connector stopped (PID ${pid})`);
  removePid();
}

export function daemonStatus(): void {
  const pid = readPid();
  if (!pid) {
    console.log('Connector is not running (no PID file)');
    process.exit(1);
  }
  if (!isAlive(pid)) {
    console.log(`Connector is not running (stale PID ${pid})`);
    removePid();
    process.exit(1);
  }
  console.log(`Connector is running (PID ${pid})`);
  console.log(`Log: ${LOG_FILE}`);
  process.exit(0);
}

export function supervisorRun(workerScript: string, configPath: string): void {
  writePid(process.pid);

  let backoffMs = 1000;
  let child: ChildProcess | null = null;
  let stopping = false;

  const spawnWorker = () => {
    const startTime = Date.now();
    log(`[supervisor] spawning worker`);

    child = fork(workerScript, ['--worker', configPath, '--log-file', LOG_FILE], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: process.env,
    });

    child.on('exit', (code, signal) => {
      child = null;

      if (stopping) {
        log(`[supervisor] worker exited (${signal ?? code}), supervisor stopping`);
        removePid();
        process.exit(0);
        return;
      }

      if (code === 0) {
        log(`[supervisor] worker exited cleanly, supervisor stopping`);
        removePid();
        process.exit(0);
        return;
      }

      const uptime = Date.now() - startTime;
      if (uptime > STABLE_THRESHOLD_MS) {
        backoffMs = 1000;
      }

      log(`[supervisor] worker crashed (code=${code}, signal=${signal}), restarting in ${backoffMs / 1000}s`);
      setTimeout(spawnWorker, backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    });
  };

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log(`[supervisor] shutting down`);
    if (child) {
      child.kill('SIGTERM');
    } else {
      removePid();
      process.exit(0);
    }
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  spawnWorker();
}
