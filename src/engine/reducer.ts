/**
 * The production reducer.
 *
 * Every structural transition is `referenceReduceMonitorState` — the mirror of
 * `spec/MonitorSystem.tla`. The reducer adds only the opaque payload the model
 * deliberately omits: the script, the cwd, the log path, and the terminal
 * detail. `emit` reports whether the line was admitted (queued for delivery) or
 * suppressed, so the runtime can keep its process-local text buffer in sync
 * with the model's `queued` count without storing payload in the model.
 */

import {
  guards as modelGuards,
  referenceReduceMonitorState,
  type AbstractMonitorState,
  type MonitorEvent,
} from "../formal/model.ts";
import {
  abstractMonitorState,
  mergeAbstract,
  monitorIds,
  monitorModelConfig,
  removeMonitors,
  setSpec,
  updateSpec,
  type MonitorPolicy,
  type MonitorState,
} from "./state.ts";

/** A command the runtime or the tool can issue. */
export type MonitorCommand =
  | { readonly type: "arm"; readonly monitor: string; readonly script: string; readonly cwd: string; readonly timeoutMs: number | null; readonly logPath: string }
  | { readonly type: "admit"; readonly monitor: string }
  | { readonly type: "emit"; readonly monitor: string }
  | { readonly type: "deliver"; readonly monitor: string }
  | { readonly type: "end-window"; readonly monitor: string }
  | { readonly type: "digest"; readonly monitor: string }
  | { readonly type: "deliver-alert"; readonly monitor: string }
  | { readonly type: "exit"; readonly monitor: string }
  | { readonly type: "crash"; readonly monitor: string; readonly detail: string; readonly exitCode: number | null; readonly signal: string | null }
  | { readonly type: "timeout"; readonly monitor: string; readonly detail: string }
  | { readonly type: "cancel"; readonly monitor: string }
  | { readonly type: "effect-stale"; readonly monitor: string }
  | { readonly type: "reconcile"; readonly monitor: string; readonly detail: string }
  | { readonly type: "clear"; readonly monitor: string }
  | { readonly type: "pi-crash" };

/** The result of one accepted command. */
export interface MonitorReduceResult {
  readonly state: MonitorState;
  readonly events: readonly MonitorEvent[];
  readonly admitted?: boolean;
}

/** Why a command was refused before touching the verified relation. */
export class MonitorCommandError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MonitorCommandError";
  }
}

function refuse(code: string, message: string): never {
  throw new MonitorCommandError(code, message);
}

/** Translate a command into the abstract events it applies. */
export function eventsForCommand(command: MonitorCommand): MonitorEvent[] {
  if (command.type === "pi-crash") return [{ type: "pi-crash" }];
  return [{ type: command.type, monitor: command.monitor } as MonitorEvent];
}

/** Ask the verified model whether one event is enabled in a live state. */
export function isEnabled(state: MonitorState, event: MonitorEvent, policy: MonitorPolicy): boolean {
  const monitors = event.type === "pi-crash" ? monitorIds(state) : [...new Set([...monitorIds(state), event.monitor])];
  const abstract = abstractMonitorState(state, monitors);
  const config = monitorModelConfig(policy, monitors);
  switch (event.type) {
    case "arm":
      return modelGuards.arm(abstract, config, event.monitor);
    case "admit":
      return modelGuards.admit(abstract, event.monitor);
    case "emit":
      return modelGuards.emit(abstract, config, event.monitor);
    case "deliver":
      return modelGuards.deliver(abstract, event.monitor);
    case "end-window":
      return modelGuards["end-window"](abstract, event.monitor);
    case "digest":
      return modelGuards.digest(abstract, event.monitor);
    case "deliver-alert":
      return modelGuards["deliver-alert"](abstract, event.monitor);
    case "exit":
      return modelGuards.exit(abstract, event.monitor);
    case "crash":
      return modelGuards.crash(abstract, event.monitor);
    case "timeout":
      return modelGuards.timeout(abstract, event.monitor);
    case "cancel":
      return modelGuards.cancel(abstract, config, event.monitor);
    case "effect-stale":
      return modelGuards["effect-stale"](abstract, event.monitor);
    case "reconcile":
      return modelGuards.reconcile(abstract, event.monitor);
    case "clear":
      return modelGuards.clear(abstract, event.monitor);
    case "pi-crash":
      return true;
  }
}

function applyEvents(state: MonitorState, events: readonly MonitorEvent[], policy: MonitorPolicy): { state: MonitorState; abstract: AbstractMonitorState } {
  const monitors = new Set(monitorIds(state));
  for (const event of events) if (event.type !== "pi-crash") monitors.add(event.monitor);
  const list = [...monitors];
  let abstract = abstractMonitorState(state, list);
  const config = monitorModelConfig(policy, list);
  for (const event of events) {
    abstract = referenceReduceMonitorState(abstract, event, config);
  }
  return { state: mergeAbstract(state, abstract), abstract };
}

/** Reduce one command against the durable state. */
export function reduceMonitorCommand(state: MonitorState, command: MonitorCommand, policy: MonitorPolicy): MonitorReduceResult {
  const events = eventsForCommand(command);
  let next: MonitorState;
  let before: AbstractMonitorState;
  let after: AbstractMonitorState;
  try {
    before = abstractMonitorState(state, monitorIds(state));
    const applied = applyEvents(state, events, policy);
    next = applied.state;
    after = applied.abstract;
  } catch (error) {
    if (error instanceof Error && error.name === "MonitorStateError") {
      refuse("monitor-transition-refused", `monitor-transition-refused: ${error.message}`);
    }
    throw error;
  }

  const now = Date.now();
  switch (command.type) {
    case "arm":
      next = setSpec(next, {
        name: command.monitor,
        script: command.script,
        cwd: command.cwd,
        timeoutMs: command.timeoutMs,
        logPath: command.logPath,
        startedAt: now,
        endedAt: null,
        exitCode: null,
        signal: null,
        detail: null,
      });
      break;
    case "exit":
      next = updateSpec(next, command.monitor, { endedAt: now, exitCode: 0, signal: null, detail: null });
      break;
    case "crash":
      next = updateSpec(next, command.monitor, { endedAt: now, exitCode: command.exitCode, signal: command.signal, detail: command.detail });
      break;
    case "timeout":
      next = updateSpec(next, command.monitor, { endedAt: now, detail: command.detail });
      break;
    case "cancel":
      next = updateSpec(next, command.monitor, { endedAt: now, detail: "cancelled" });
      break;
    case "reconcile":
      next = updateSpec(next, command.monitor, { endedAt: now, detail: command.detail });
      break;
    case "clear":
      // The abstract state reset to absent; the opaque spec is dropped so the
      // board stops listing the monitor. Undefined fields read as the same
      // defaults the model just installed.
      next = removeMonitors(next, [command.monitor]);
      break;
    default:
      break;
  }

  next = { ...next, revision: state.revision + events.length };
  const admitted =
    command.type === "emit" ? (after.queued[command.monitor] ?? 0) > (before.queued[command.monitor] ?? 0) : undefined;
  return { state: next, events, ...(admitted === undefined ? {} : { admitted }) };
}
