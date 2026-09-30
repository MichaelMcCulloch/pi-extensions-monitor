/**
 * The runtime: the lifecycle half, and the only writer of the lifecycle
 * actions (`arm`, `admit`, `exit`, `crash`, `timeout`, `cancel`,
 * `effect-stale`, `reconcile`, `pi-crash`).
 *
 * It spawns the process, maps every OS outcome onto a model event, emits each
 * stdout line on the shared bus for the injector, and sends the one alert the
 * model requires. There is no second copy of the state: the store's reducer is
 * `referenceReduceMonitorState`.
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isLiveMonitor,
  knownMonitorIds,
  monitorIds,
  type MonitorSpecRecord,
} from "../engine/state.ts";
import type { MonitorId } from "../formal/model.ts";
import { monitorPrefix, MONITOR_LINE_CHANNEL, type OutgoingMessage } from "./injector.ts";
import type { MonitorInjector } from "./injector.ts";
import type { MonitorStore } from "./store.ts";
import { MonitorSupervisor, SupervisorError } from "./supervisor.ts";

export interface MonitorRuntimeOptions {
  readonly store: MonitorStore;
  readonly supervisor: MonitorSupervisor;
  readonly injector: MonitorInjector;
  readonly events: { emit(channel: string, data: unknown): void };
  readonly send: (outgoing: OutgoingMessage) => void;
  readonly logDir?: string;
}

export interface ArmInput {
  readonly name: string;
  readonly script: string;
  readonly cwd: string;
  readonly timeoutMs?: number | null;
}

/** The result of a clear: what was forgotten and what had to stay. */
export interface ClearOutcome {
  readonly cleared: readonly MonitorId[];
  readonly kept: readonly MonitorId[];
}

/** A refusal carrying a stable code. */
export class MonitorRuntimeError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MonitorRuntimeError";
  }
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class MonitorRuntime {
  readonly #options: MonitorRuntimeOptions;
  readonly #logDir: string;

  public constructor(options: MonitorRuntimeOptions) {
    this.#options = options;
    this.#logDir = options.logDir ?? tmpdir();
  }

  public get store(): MonitorStore {
    return this.#options.store;
  }

  /** Arm a fresh generation and start its process. */
  public arm(input: ArmInput): MonitorSpecRecord {
    if (!NAME_PATTERN.test(input.name)) throw new MonitorRuntimeError("monitor-invalid-name", `invalid monitor name "${input.name}"`);
    const state = this.#options.store.state;
    const status = state.status[input.name] ?? "absent";
    if (status === "armed" || status === "running") {
      throw new MonitorRuntimeError("monitor-name-busy", `monitor "${input.name}" is already running`);
    }
    const logPath = join(this.#logDir, `pi-monitor-${randomUUID()}.log`);
    const timeoutMs = input.timeoutMs ?? null;
    this.#options.store.arm({ monitor: input.name, script: input.script, cwd: input.cwd, timeoutMs, logPath });
    this.#options.store.admit(input.name);
    try {
      this.#options.supervisor.spawn(
        { name: input.name, script: input.script, cwd: input.cwd, timeoutMs, logPath },
        {
          onLine: (name, text) => this.#options.events.emit(MONITOR_LINE_CHANNEL, { name, text }),
          onExit: (name, code, signal, killed) => this.#onExit(name, code, signal, killed),
          onError: (name, error) => this.#onError(name, error),
          onTimeout: (name) => this.#onTimeout(name),
        },
      );
    } catch (error) {
      const detail = error instanceof SupervisorError ? error.message : String(error);
      this.#options.store.crash(input.name, `spawn failed: ${detail}`, null, null);
      this.#options.injector.flushAll();
      this.sendAlert(input.name);
      throw new MonitorRuntimeError("monitor-spawn-failed", detail);
    }
    return this.#options.store.state.specs[input.name]!;
  }

  /** Stop a monitor: fence its generation and kill the group. */
  public cancel(name: string): MonitorSpecRecord {
    const spec = this.#options.store.state.specs[name];
    if (spec === undefined) throw new MonitorRuntimeError("monitor-unknown", `unknown monitor "${name}"`);
    const status = this.#options.store.state.status[name] ?? "absent";
    if (status !== "armed" && status !== "running") {
      if (status === "disarmed") {
        throw new MonitorRuntimeError(
          "monitor-not-running",
          `monitor "${name}" has already finished; use monitor action=clear to forget it`,
        );
      }
      throw new MonitorRuntimeError("monitor-not-running", `monitor "${name}" is not running`);
    }
    this.#options.store.cancel(name);
    this.#options.supervisor.kill(name);
    this.#options.injector.flushAll();
    return spec;
  }

  /**
   * Forget finished monitors using the verified `clear` transition. With a
   * name, only that finished monitor; without, every monitor whose guard is
   * enabled. Running monitors are never touched; log files are left on disk.
   */
  public clear(name?: string): ClearOutcome {
    const store = this.#options.store;
    if (name !== undefined) {
      if (!monitorIds(store.state).includes(name)) {
        throw new MonitorRuntimeError("monitor-unknown", `unknown monitor "${name}"`);
      }
      if (isLiveMonitor(store.state, name)) {
        throw new MonitorRuntimeError("monitor-clear-active", `monitor "${name}" is still running; cancel it first`);
      }
      if (!store.canClear(name)) {
        throw new MonitorRuntimeError(
          "monitor-not-settled",
          `monitor "${name}" still has undelivered output, a pending notice, or a live effect`,
        );
      }
      this.#options.injector.forget(name);
      store.clear(name);
      return { cleared: [name], kept: [] };
    }
    const known = knownMonitorIds(store.state);
    const cleared = known.filter((monitor) => store.canClear(monitor));
    const kept = known.filter((monitor) => !store.canClear(monitor));
    for (const monitor of cleared) this.#options.injector.forget(monitor);
    for (const monitor of cleared) store.clear(monitor);
    return { cleared, kept };
  }

  /** Flush delivery at a settle boundary. */
  public settle(): void {
    this.#options.injector.flushAll();
  }

  /** Kill everything and drop delivery state; the session is ending. */
  public shutdown(): void {
    this.#options.supervisor.shutdown();
    this.#options.injector.stop();
  }

  /**
   * Recover after process death: every effect is lost, so every running monitor
   * is reconciled (one notice) and every armed monitor is cancelled.
   */
  public reconcileOnLoad(): void {
    this.#options.store.piCrash();
    for (const name of Object.keys(this.#options.store.state.specs)) {
      const status = this.#options.store.state.status[name] ?? "absent";
      if (status === "running") {
        this.#options.store.reconcile(name, `monitor "${name}" was running when pi exited; disarmed`);
        this.sendAlert(name);
      } else if (status === "armed") {
        this.#options.store.cancel(name);
      }
    }
    this.#options.injector.flushAll();
  }

  /** Send the one alert a crash/timeout/reconcile requires. */
  public sendAlert(name: string): void {
    const store = this.#options.store;
    if (store.state.alertPending[name] !== true) return;
    const spec = store.state.specs[name];
    const terminal = store.state.terminal[name] ?? "none";
    const logPath = spec?.logPath ?? "(unknown)";
    const detail = spec?.detail ?? terminal;
    const text =
      terminal === "timedout"
        ? `timed out: ${detail}`
        : terminal === "reconciled"
          ? `${detail}`
          : `crashed: ${detail}`;
    store.deliverAlert(name);
    this.#options.send({
      message: {
        customType: "monitor/output",
        content: `${monitorPrefix(name)} ${text} (log: ${logPath})`,
        display: true,
        details: { name, kind: "alert", terminal, logPath },
      },
      options: { triggerTurn: true },
    });
  }

  #onExit(name: string, code: number | null, signal: string | null, killed: boolean): void {
    const store = this.#options.store;
    if (killed) {
      const effect = store.state.effect[name] ?? "idle";
      const fence = store.state.effectFence[name] ?? 0;
      const gen = store.state.gen[name] ?? 0;
      if (effect === "running" && fence < gen) store.effectStale(name);
      return;
    }
    if (code === 0 && signal === null) {
      store.exit(name);
      this.#options.injector.flushAll();
      return;
    }
    const detail = signal !== null ? `killed by ${signal}` : `exit ${code}`;
    store.crash(name, detail, code, signal);
    this.#options.injector.flushAll();
    this.sendAlert(name);
  }

  #onError(name: string, error: Error): void {
    this.#options.store.crash(name, `failed: ${error.message}`, null, null);
    this.#options.injector.flushAll();
    this.sendAlert(name);
  }

  #onTimeout(name: string): void {
    const timeoutMs = this.#options.store.state.specs[name]?.timeoutMs;
    this.#options.store.timeout(name, `after ${timeoutMs ?? "?"}ms`);
    this.#options.injector.flushAll();
    this.sendAlert(name);
  }
}
