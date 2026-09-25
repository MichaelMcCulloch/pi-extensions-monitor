/**
 * The durable monitor store.
 *
 * One state, one reducer: every mutation is a command whose structural
 * transition is `referenceReduceMonitorState` — the mirror of
 * `spec/MonitorSystem.tla`. The store re-checks the invariant after every
 * command and refuses to persist a violating state.
 */

import {
  MonitorCommandError,
  reduceMonitorCommand,
  type MonitorCommand,
  type MonitorReduceResult,
} from "../engine/reducer.ts";
import { initMonitorState, normalizeMonitorState, type MonitorPolicy, type MonitorState } from "../engine/state.ts";
import { verifyMonitorState } from "../engine/verify.ts";
import { MonitorStateError, type MonitorViolation } from "../formal/model.ts";

/** Where snapshots go. `pi.appendEntry` in production, an array in tests. */
export interface MonitorPersistence {
  append(snapshot: MonitorState): void;
}

/** A store error carrying a stable code. */
export class MonitorOperationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MonitorOperationError";
  }
}

/** The durable store. */
export class MonitorStore {
  #state: MonitorState;
  readonly #persistence: MonitorPersistence;
  readonly #policy: MonitorPolicy;

  public constructor(persistence: MonitorPersistence, initial: MonitorState = initMonitorState(), policy: MonitorPolicy) {
    this.#persistence = persistence;
    this.#policy = policy;
    this.#state = normalizeMonitorState(initial);
  }

  public get state(): MonitorState {
    return this.#state;
  }

  public get policy(): MonitorPolicy {
    return this.#policy;
  }

  public violations(): readonly MonitorViolation[] {
    return verifyMonitorState(this.#state, this.#policy);
  }

  /** Apply one command, persist the successor, and return both. */
  public apply(command: MonitorCommand): MonitorReduceResult {
    let result: MonitorReduceResult;
    try {
      result = reduceMonitorCommand(this.#state, command, this.#policy);
    } catch (error) {
      if (error instanceof MonitorCommandError) throw new MonitorOperationError(error.code, error.message);
      if (error instanceof MonitorStateError) throw new MonitorOperationError("monitor-transition-refused", error.message);
      throw error;
    }
    if (result.events.length === 0) return result;
    const violations = verifyMonitorState(result.state, this.#policy);
    if (violations.length > 0) {
      throw new MonitorOperationError(
        "monitor-invariant-violation",
        violations.map((violation) => `${violation.invariant}: ${violation.detail}`).join("; "),
      );
    }
    this.#state = result.state;
    this.#persistence.append(this.#state);
    return result;
  }

  public arm(input: { monitor: string; script: string; cwd: string; timeoutMs: number | null; logPath: string }): MonitorReduceResult {
    return this.apply({ type: "arm", ...input });
  }

  public admit(monitor: string): MonitorReduceResult {
    return this.apply({ type: "admit", monitor });
  }

  public emit(monitor: string): MonitorReduceResult {
    return this.apply({ type: "emit", monitor });
  }

  public deliver(monitor: string): MonitorReduceResult {
    return this.apply({ type: "deliver", monitor });
  }

  public endWindow(monitor: string): MonitorReduceResult {
    return this.apply({ type: "end-window", monitor });
  }

  /** Digest the suppressed lines of the closed window; returns how many. */
  public digest(monitor: string): { result: MonitorReduceResult; digested: number } {
    const digested = this.#state.suppressed[monitor] ?? 0;
    return { result: this.apply({ type: "digest", monitor }), digested };
  }

  public deliverAlert(monitor: string): MonitorReduceResult {
    return this.apply({ type: "deliver-alert", monitor });
  }

  public exit(monitor: string): MonitorReduceResult {
    return this.apply({ type: "exit", monitor });
  }

  public crash(monitor: string, detail: string, exitCode: number | null, signal: string | null): MonitorReduceResult {
    return this.apply({ type: "crash", monitor, detail, exitCode, signal });
  }

  public timeout(monitor: string, detail: string): MonitorReduceResult {
    return this.apply({ type: "timeout", monitor, detail });
  }

  public cancel(monitor: string): MonitorReduceResult {
    return this.apply({ type: "cancel", monitor });
  }

  public effectStale(monitor: string): MonitorReduceResult {
    return this.apply({ type: "effect-stale", monitor });
  }

  public reconcile(monitor: string, detail: string): MonitorReduceResult {
    return this.apply({ type: "reconcile", monitor, detail });
  }

  public piCrash(): MonitorReduceResult {
    return this.apply({ type: "pi-crash" });
  }

  /** Replace the durable state, e.g. when restoring a recovered snapshot. */
  public restore(state: MonitorState): void {
    this.#state = normalizeMonitorState(state);
    this.#persistence.append(this.#state);
  }
}

/** An in-memory store for tests and trace generation. */
export function memoryMonitorStore(policy: MonitorPolicy, initial: MonitorState = initMonitorState()): MonitorStore {
  return new MonitorStore({ append: () => {} }, initial, policy);
}
