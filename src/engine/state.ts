/**
 * The production monitor state.
 *
 * `MonitorState` extends the abstract machine with the opaque payload the
 * presentation reads but no guard ever inspects: the script, the cwd, the log
 * path, and the terminal detail. Timestamps and revision are bookkeeping
 * outside the verified machine.
 *
 * One session, one state. Times are informational only; the model compares
 * counters and statuses.
 */

import type {
  AbstractMonitorState,
  EffectState,
  MonitorId,
  MonitorModelConfig,
  MonitorStatus,
  Terminal,
} from "../formal/model.ts";

/** The opaque, per-monitor payload. */
export interface MonitorSpecRecord {
  readonly name: MonitorId;
  readonly script: string;
  readonly cwd: string;
  readonly timeoutMs: number | null;
  readonly logPath: string;
  readonly startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  detail: string | null;
}

/** The runtime rate policy, mirrored by the model's `Rate` and `Cap` constants. */
export interface MonitorPolicy {
  /** Lines admitted per rate window. */
  readonly rate: number;
  /** Maximum admitted-but-undelivered lines (backpressure bound). */
  readonly cap: number;
  /** Rate window length in milliseconds. */
  readonly windowMs: number;
  /** Coalesce window length in milliseconds. */
  readonly flushMs: number;
  /** Maximum lines per injected message. */
  readonly maxBatch: number;
}

export const DEFAULT_MONITOR_POLICY: MonitorPolicy = {
  rate: 60,
  cap: 200,
  windowMs: 1000,
  flushMs: 25,
  maxBatch: 50,
};

/** The durable monitor state. */
export interface MonitorState extends AbstractMonitorState {
  readonly specs: Readonly<Record<MonitorId, MonitorSpecRecord>>;
  readonly revision: number;
}

function emptyFunction<T>(value: T): Record<MonitorId, T> {
  return {};
}

/** A fresh, empty state. */
export function initMonitorState(): MonitorState {
  return {
    status: emptyFunction<MonitorStatus>("absent"),
    gen: emptyFunction(0),
    effect: emptyFunction<EffectState>("idle"),
    effectFence: emptyFunction(0),
    terminal: emptyFunction<Terminal>("none"),
    produced: emptyFunction(0),
    delivered: emptyFunction(0),
    queued: emptyFunction(0),
    windowAdmitted: emptyFunction(0),
    suppressed: emptyFunction(0),
    digested: emptyFunction(0),
    digestDue: emptyFunction(false),
    alertPending: emptyFunction(false),
    alertSent: emptyFunction(false),
    specs: {},
    revision: 0,
  };
}

/** Every monitor named anywhere in the state. */
export function monitorIds(state: MonitorState): MonitorId[] {
  const ids = new Set<MonitorId>([
    ...Object.keys(state.status),
    ...Object.keys(state.specs),
    ...Object.keys(state.gen),
  ]);
  return [...ids].sort();
}

/** Project the durable state onto the verified abstract state. */
export function abstractMonitorState(state: MonitorState, monitors?: readonly MonitorId[]): AbstractMonitorState {
  const ids = monitors ?? monitorIds(state);
  const status: Record<MonitorId, MonitorStatus> = {};
  const gen: Record<MonitorId, number> = {};
  const effect: Record<MonitorId, EffectState> = {};
  const effectFence: Record<MonitorId, number> = {};
  const terminal: Record<MonitorId, Terminal> = {};
  const produced: Record<MonitorId, number> = {};
  const delivered: Record<MonitorId, number> = {};
  const queued: Record<MonitorId, number> = {};
  const windowAdmitted: Record<MonitorId, number> = {};
  const suppressed: Record<MonitorId, number> = {};
  const digested: Record<MonitorId, number> = {};
  const digestDue: Record<MonitorId, boolean> = {};
  const alertPending: Record<MonitorId, boolean> = {};
  const alertSent: Record<MonitorId, boolean> = {};
  for (const id of ids) {
    status[id] = state.status[id] ?? "absent";
    gen[id] = state.gen[id] ?? 0;
    effect[id] = state.effect[id] ?? "idle";
    effectFence[id] = state.effectFence[id] ?? 0;
    terminal[id] = state.terminal[id] ?? "none";
    produced[id] = state.produced[id] ?? 0;
    delivered[id] = state.delivered[id] ?? 0;
    queued[id] = state.queued[id] ?? 0;
    windowAdmitted[id] = state.windowAdmitted[id] ?? 0;
    suppressed[id] = state.suppressed[id] ?? 0;
    digested[id] = state.digested[id] ?? 0;
    digestDue[id] = state.digestDue[id] ?? false;
    alertPending[id] = state.alertPending[id] ?? false;
    alertSent[id] = state.alertSent[id] ?? false;
  }
  return { status, gen, effect, effectFence, terminal, produced, delivered, queued, windowAdmitted, suppressed, digested, digestDue, alertPending, alertSent };
}

/** The verification universe uses production bounds; traces use the fixture. */
export function monitorModelConfig(policy: MonitorPolicy, monitors?: readonly MonitorId[]): MonitorModelConfig {
  return {
    monitors: monitors ?? [],
    rate: policy.rate,
    cap: policy.cap,
    maxGen: Number.MAX_SAFE_INTEGER,
    maxEmitted: Number.MAX_SAFE_INTEGER,
  };
}

/** Fill any fields a snapshot predating the current schema may lack. */
export function normalizeMonitorState(state: MonitorState): MonitorState {
  const ids = monitorIds(state);
  const status: Record<MonitorId, MonitorStatus> = {};
  const gen: Record<MonitorId, number> = {};
  const effect: Record<MonitorId, EffectState> = {};
  const effectFence: Record<MonitorId, number> = {};
  const terminal: Record<MonitorId, Terminal> = {};
  const produced: Record<MonitorId, number> = {};
  const delivered: Record<MonitorId, number> = {};
  const queued: Record<MonitorId, number> = {};
  const windowAdmitted: Record<MonitorId, number> = {};
  const suppressed: Record<MonitorId, number> = {};
  const digested: Record<MonitorId, number> = {};
  const digestDue: Record<MonitorId, boolean> = {};
  const alertPending: Record<MonitorId, boolean> = {};
  const alertSent: Record<MonitorId, boolean> = {};
  for (const id of ids) {
    status[id] = state.status[id] ?? "absent";
    gen[id] = state.gen[id] ?? 0;
    effect[id] = state.effect[id] ?? "idle";
    effectFence[id] = state.effectFence[id] ?? 0;
    terminal[id] = state.terminal[id] ?? "none";
    produced[id] = state.produced[id] ?? 0;
    delivered[id] = state.delivered[id] ?? 0;
    queued[id] = state.queued[id] ?? 0;
    windowAdmitted[id] = state.windowAdmitted[id] ?? 0;
    suppressed[id] = state.suppressed[id] ?? 0;
    digested[id] = state.digested[id] ?? 0;
    digestDue[id] = state.digestDue[id] ?? false;
    alertPending[id] = state.alertPending[id] ?? false;
    alertSent[id] = state.alertSent[id] ?? false;
  }
  return {
    status,
    gen,
    effect,
    effectFence,
    terminal,
    produced,
    delivered,
    queued,
    windowAdmitted,
    suppressed,
    digested,
    digestDue,
    alertPending,
    alertSent,
    specs: { ...state.specs },
    revision: state.revision ?? 0,
  };
}

/** Merge a reduced abstract state back into the durable state. */
export function mergeAbstract(state: MonitorState, abstract: AbstractMonitorState): MonitorState {
  return {
    ...state,
    status: abstract.status,
    gen: abstract.gen,
    effect: abstract.effect,
    effectFence: abstract.effectFence,
    terminal: abstract.terminal,
    produced: abstract.produced,
    delivered: abstract.delivered,
    queued: abstract.queued,
    windowAdmitted: abstract.windowAdmitted,
    suppressed: abstract.suppressed,
    digested: abstract.digested,
    digestDue: abstract.digestDue,
    alertPending: abstract.alertPending,
    alertSent: abstract.alertSent,
  };
}

export function isLiveMonitor(state: MonitorState, monitor: MonitorId): boolean {
  const status = state.status[monitor] ?? "absent";
  return status === "armed" || status === "running";
}

/** Every monitor that has a recorded spec, sorted; the universe the UI can show. */
export function knownMonitorIds(state: MonitorState): MonitorId[] {
  return Object.keys(state.specs).sort();
}

/** The monitors still armed or running, sorted. */
export function activeMonitorIds(state: MonitorState): MonitorId[] {
  return knownMonitorIds(state).filter((monitor) => isLiveMonitor(state, monitor));
}

/**
 * The monitors that have finished (anything not live), sorted.
 */
export function finishedMonitorIds(state: MonitorState): MonitorId[] {
  return knownMonitorIds(state).filter((monitor) => !isLiveMonitor(state, monitor));
}

export function setSpec(state: MonitorState, spec: MonitorSpecRecord): MonitorState {
  return { ...state, specs: { ...state.specs, [spec.name]: spec } };
}

export function updateSpec(state: MonitorState, monitor: MonitorId, patch: Partial<MonitorSpecRecord>): MonitorState {
  const current = state.specs[monitor];
  if (current === undefined) return state;
  return { ...state, specs: { ...state.specs, [monitor]: { ...current, ...patch } } };
}

/** Drop every per-monitor entry for the named monitors; the reducer owns revision. */
export function removeMonitors(state: MonitorState, names: readonly MonitorId[]): MonitorState {
  const drop = new Set<MonitorId>(names);
  const omit = <K extends string, V>(record: Readonly<Record<K, V>>): Record<K, V> => {
    const out = {} as Record<K, V>;
    for (const key of Object.keys(record) as K[]) if (!drop.has(key as unknown as MonitorId)) out[key] = record[key]!;
    return out;
  };
  return {
    status: omit(state.status),
    gen: omit(state.gen),
    effect: omit(state.effect),
    effectFence: omit(state.effectFence),
    terminal: omit(state.terminal),
    produced: omit(state.produced),
    delivered: omit(state.delivered),
    queued: omit(state.queued),
    windowAdmitted: omit(state.windowAdmitted),
    suppressed: omit(state.suppressed),
    digested: omit(state.digested),
    digestDue: omit(state.digestDue),
    alertPending: omit(state.alertPending),
    alertSent: omit(state.alertSent),
    specs: omit(state.specs),
    revision: state.revision,
  };
}
