/**
 * Trace generation for TLC trace validation.
 *
 * The traces are produced by driving the **production store** one command at a
 * time and recording the abstract state after every event it emits. The store's
 * transition IS `referenceReduceMonitorState` (the mirror of
 * `spec/MonitorSystem.tla`), so replaying these traces checks the production
 * command→event mapping and the store's bookkeeping against the one model.
 */

import { abstractMonitorState, type MonitorPolicy } from "../engine/state.ts";
import type { MonitorCommand } from "../engine/reducer.ts";
import { memoryMonitorStore as memoryStore } from "../extension/store.ts";
import {
  initAbstractMonitorState,
  referenceReduceMonitorState,
  type AbstractMonitorState,
  type MonitorEvent,
  type MonitorModelConfig,
} from "./model.ts";

/** The trace universe; TraceValidation.cfg must use the same constants. */
export const TRACE_MONITORS = ["m1", "m2"];
export const TRACE_RATE = 2;
export const TRACE_CAP = 4;
export const TRACE_MAX_GEN = 4;
export const TRACE_MAX_EMITTED = 8;

export const TRACE_POLICY: MonitorPolicy = { rate: TRACE_RATE, cap: TRACE_CAP, windowMs: 1000, flushMs: 0, maxBatch: 1000 };
export const TRACE_CONFIG: MonitorModelConfig = {
  monitors: TRACE_MONITORS,
  rate: TRACE_RATE,
  cap: TRACE_CAP,
  maxGen: TRACE_MAX_GEN,
  maxEmitted: TRACE_MAX_EMITTED,
};

/** One recorded step. The first step has `event: null`. */
export interface TraceStep {
  readonly event: MonitorEvent | null;
  readonly state: AbstractMonitorState;
}

/** A named scenario: a sequence of production commands. */
export interface Scenario {
  readonly name: string;
  readonly commands: readonly MonitorCommand[];
}

const arm = (monitor: string, script: string): MonitorCommand => ({
  type: "arm",
  monitor,
  script,
  cwd: "/tmp",
  timeoutMs: null,
  logPath: `/tmp/pi-monitor-${monitor}.log`,
});
const admit = (monitor: string): MonitorCommand => ({ type: "admit", monitor });
const emit = (monitor: string): MonitorCommand => ({ type: "emit", monitor });
const deliver = (monitor: string): MonitorCommand => ({ type: "deliver", monitor });
const endWindow = (monitor: string): MonitorCommand => ({ type: "end-window", monitor });
const digest = (monitor: string): MonitorCommand => ({ type: "digest", monitor });
const deliverAlert = (monitor: string): MonitorCommand => ({ type: "deliver-alert", monitor });
const exit = (monitor: string): MonitorCommand => ({ type: "exit", monitor });
const crash = (monitor: string): MonitorCommand => ({ type: "crash", monitor, detail: "exit 1", exitCode: 1, signal: null });
const timeout = (monitor: string): MonitorCommand => ({ type: "timeout", monitor, detail: "after 1000ms" });
const cancel = (monitor: string): MonitorCommand => ({ type: "cancel", monitor });
const effectStale = (monitor: string): MonitorCommand => ({ type: "effect-stale", monitor });
const reconcile = (monitor: string): MonitorCommand => ({ type: "reconcile", monitor, detail: "was running when pi exited" });
const clear = (monitor: string): MonitorCommand => ({ type: "clear", monitor });
const piCrash: MonitorCommand = { type: "pi-crash" };

/** The scenarios the validator replays, covering every action. */
export function scenarios(): Scenario[] {
  return [
    {
      name: "one-shot-and-digest",
      commands: [arm("m1", "echo hi"), admit("m1"), emit("m1"), emit("m1"), emit("m1"), deliver("m1"), deliver("m1"), endWindow("m1"), digest("m1"), exit("m1")],
    },
    {
      name: "crash-alert",
      commands: [arm("m1", "false"), admit("m1"), emit("m1"), deliver("m1"), crash("m1"), deliverAlert("m1")],
    },
    {
      name: "timeout-alert",
      commands: [arm("m1", "sleep 9"), admit("m1"), timeout("m1"), deliverAlert("m1")],
    },
    {
      name: "cancel-and-rearm-fence",
      commands: [arm("m1", "loop"), admit("m1"), cancel("m1"), effectStale("m1"), arm("m1", "again"), admit("m1"), emit("m1"), deliver("m1"), exit("m1")],
    },
    {
      name: "pi-crash-reconcile",
      commands: [arm("m1", "long"), admit("m1"), piCrash, reconcile("m1"), deliverAlert("m1")],
    },
    {
      name: "clear-and-rearm",
      commands: [
        arm("m1", "once"),
        admit("m1"),
        emit("m1"),
        deliver("m1"),
        exit("m1"),
        arm("m2", "peer"),
        admit("m2"),
        emit("m2"),
        clear("m1"),
        arm("m1", "again"),
        admit("m1"),
        emit("m1"),
        deliver("m1"),
        exit("m1"),
        deliver("m2"),
        exit("m2"),
      ],
    },
    {
      name: "two-monitors-fifo",
      commands: [arm("m1", "a"), admit("m1"), arm("m2", "b"), admit("m2"), emit("m1"), emit("m2"), deliver("m1"), deliver("m2"), exit("m1"), exit("m2")],
    },
    {
      name: "rate-window-suppression",
      commands: [arm("m1", "spam"), admit("m1"), emit("m1"), emit("m1"), emit("m1"), emit("m1"), emit("m1"), deliver("m1"), deliver("m1"), endWindow("m1"), digest("m1"), exit("m1")],
    },
  ];
}

function sameAbstract(left: AbstractMonitorState, right: AbstractMonitorState): boolean {
  const fields: (keyof AbstractMonitorState)[] = [
    "status",
    "gen",
    "effect",
    "effectFence",
    "terminal",
    "produced",
    "delivered",
    "queued",
    "windowAdmitted",
    "suppressed",
    "digested",
    "digestDue",
    "alertPending",
    "alertSent",
  ];
  return (
    JSON.stringify(fields.map((field) => TRACE_MONITORS.map((monitor) => (left[field] as Record<string, unknown>)[monitor]))) ===
    JSON.stringify(fields.map((field) => TRACE_MONITORS.map((monitor) => (right[field] as Record<string, unknown>)[monitor])))
  );
}

/** Drive a scenario through the production store and record every transition. */
export function runScenario(scenario: Scenario): TraceStep[] {
  const store = memoryStore(TRACE_POLICY);
  let state = initAbstractMonitorState(TRACE_CONFIG);
  const trace: TraceStep[] = [{ event: null, state }];
  for (const command of scenario.commands) {
    const result = store.apply(command);
    for (const event of result.events) {
      state = referenceReduceMonitorState(state, event, TRACE_CONFIG);
      trace.push({ event, state });
    }
    const projected = abstractMonitorState(store.state, TRACE_MONITORS);
    if (!sameAbstract(projected, state)) {
      throw new Error(`trace divergence in ${scenario.name} at ${command.type}: production != model`);
    }
  }
  return trace;
}

/* -------------------------------------------------------------------------- */
/* TLA+ rendering                                                             */
/* -------------------------------------------------------------------------- */

const STATE_FIELDS: (keyof AbstractMonitorState)[] = [
  "status",
  "gen",
  "effect",
  "effectFence",
  "terminal",
  "produced",
  "delivered",
  "queued",
  "windowAdmitted",
  "suppressed",
  "digested",
  "digestDue",
  "alertPending",
  "alertSent",
];

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function record(keys: readonly string[], render: (key: string) => string): string {
  return `[ ${keys.map((key) => `${key} |-> ${render(key)}`).join(", ")} ]`;
}

function valueTla(value: unknown): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return quote(String(value));
}

function tlaState(state: AbstractMonitorState): string {
  const fields = STATE_FIELDS.map((field) => {
    const table = state[field] as Record<string, unknown>;
    return `${String(field)} |-> ${record(TRACE_MONITORS, (monitor) => valueTla(table[monitor]))}`;
  });
  return `[ ${fields.join(", ")} ]`;
}

function tlaEvent(event: MonitorEvent | null): string {
  const type = event?.type ?? "init";
  const monitor = event === null || event.type === "pi-crash" ? "none" : event.monitor;
  return `[ type |-> ${quote(type)}, monitor |-> ${quote(monitor)} ]`;
}

function tlaTrace(steps: readonly TraceStep[]): string {
  const records = steps.map((step) => `[ event |-> ${tlaEvent(step.event)}, state |-> ${tlaState(step.state)} ]`);
  return `<<\n  ${records.join(",\n  ")}\n>>`;
}

/** Render the generated `TracesData` module TLC consumes. */
export function renderTracesModule(traces: readonly (readonly TraceStep[])[]): string {
  const rendered = traces.map((trace, index) => `\\* trace ${index}\n${tlaTrace(trace)}`);
  return [
    "---------------------------- MODULE TracesData ----------------------------",
    "\\* Generated by scripts/emit-traces.ts. Do not edit.",
    "",
    `Traces == <<\n${rendered.join(",\n")}\n>>`,
    "",
    "=============================================================================",
    "",
  ].join("\n");
}

/** Build every scenario trace from the production store. */
export function buildTraces(): { name: string; trace: TraceStep[] }[] {
  return scenarios().map((scenario) => ({ name: scenario.name, trace: runScenario(scenario) }));
}
