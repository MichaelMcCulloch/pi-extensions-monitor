/**
 * The process supervisor: the OS boundary.
 *
 * It spawns `sh -c <script>` in its own process group, appends every stdout and
 * stderr line to the per-monitor log, and turns stdout lines into callbacks. It
 * owns no model state and makes no delivery decisions: the runtime owns the
 * lifecycle, the injector owns delivery, and the store owns the verified state.
 *
 * Every outcome the OS can produce (line, exit, signal, spawn error, timeout)
 * is a callback the runtime maps onto a model event, so the verified alphabet
 * stays closed.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";

export interface SupervisorCallbacks {
  onLine(name: string, text: string): void;
  onExit(name: string, code: number | null, signal: string | null, killed: boolean): void;
  onError(name: string, error: Error): void;
  onTimeout(name: string): void;
}

export interface SpawnRequest {
  readonly name: string;
  readonly script: string;
  readonly cwd: string;
  readonly timeoutMs: number | null;
  readonly logPath: string;
}

interface ChildHandle {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly stdout: Interface;
  readonly stderr: Interface;
  readonly timer: NodeJS.Timeout | null;
  killed: boolean;
}

export class SupervisorError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SupervisorError";
  }
}

export class MonitorSupervisor {
  readonly #children = new Map<string, ChildHandle>();
  readonly #lineCap: number;

  public constructor(lineCap = 8192) {
    this.#lineCap = lineCap;
  }

  public isAlive(name: string): boolean {
    return this.#children.has(name);
  }

  /** Create the log and spawn the script. Throws {@link SupervisorError} if it cannot. */
  public spawn(request: SpawnRequest, callbacks: SupervisorCallbacks): void {
    try {
      writeFileSync(request.logPath, "");
    } catch (error) {
      throw new SupervisorError("monitor-log-unwritable", `cannot create ${request.logPath}: ${(error as Error).message}`);
    }
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn("sh", ["-c", request.script], {
        cwd: request.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, MONITOR_NAME: request.name, MONITOR_LOG: request.logPath },
      });
    } catch (error) {
      throw new SupervisorError("monitor-spawn-failed", (error as Error).message);
    }

    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity });
    const timer =
      request.timeoutMs === null
        ? null
        : setTimeout(() => {
            const handle = this.#children.get(request.name);
            if (handle === undefined) return;
            handle.killed = true;
            this.#killGroup(handle.child);
            callbacks.onTimeout(request.name);
          }, request.timeoutMs);

    const handle: ChildHandle = { child, stdout, stderr, timer, killed: false };
    this.#children.set(request.name, handle);

    stdout.on("line", (line: string) => {
      const text = line.length > this.#lineCap ? `${line.slice(0, this.#lineCap)} …[+${line.length - this.#lineCap} chars; log: ${request.logPath}]` : line;
      this.#log(request.logPath, line);
      callbacks.onLine(request.name, text);
    });
    stderr.on("line", (line: string) => this.#log(request.logPath, `stderr: ${line}`));

    child.on("error", (error: Error) => {
      if (this.#children.get(request.name) !== handle) return;
      callbacks.onError(request.name, error);
    });

    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      const current = this.#children.get(request.name);
      if (current === handle) this.#children.delete(request.name);
      stdout.close();
      stderr.close();
      if (timer !== null) clearTimeout(timer);
      callbacks.onExit(request.name, code, signal, handle.killed);
    });
  }

  /** Kill the process group and mark the exit as ours (a stale generation). */
  public kill(name: string): void {
    const handle = this.#children.get(name);
    if (handle === undefined) return;
    handle.killed = true;
    if (handle.timer !== null) clearTimeout(handle.timer);
    this.#killGroup(handle.child);
    this.#children.delete(name);
  }

  /** Pause the stdout stream for backpressure. */
  public pause(name: string): void {
    this.#children.get(name)?.stdout.pause();
  }

  public resume(name: string): void {
    this.#children.get(name)?.stdout.resume();
  }

  /** Kill every live child. Idempotent. */
  public shutdown(): void {
    for (const name of [...this.#children.keys()]) this.kill(name);
    this.#children.clear();
  }

  #log(logPath: string, line: string): void {
    try {
      appendFileSync(logPath, `${line}\n`);
    } catch {
      // The log is diagnostic; a write failure must not stop the wake.
    }
  }

  #killGroup(child: ChildProcessByStdio<null, Readable, Readable>): void {
    const pid = child.pid;
    if (pid === undefined) return;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    const hard = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // already gone
      }
    }, 250);
    hard.unref?.();
  }
}
