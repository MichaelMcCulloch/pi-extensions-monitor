/**
 * The executable abstract model of the monitor.
 *
 * This is a transcription of `spec/MonitorSystem.tla`. The production store
 * calls `referenceReduceMonitorState` directly; `test/model.spec.ts` explores
 * the model exhaustively and asserts the reachable-set size equals the number
 * TLC reports (2701 for the fixture), and `spec/TraceValidation.tla` replays
 * production traces against the spec.
 *
 * The machine owns the lifecycle (`status`, `gen`, `effect`, `effectFence`,
 * `terminal`), the rate-limited event ledger (`produced`, `delivered`,
 * `queued`, `suppressed`, `digested`, `windowAdmitted`, `digestDue`), and the
 * notices (`alertPending`, `alertSent`). There is no output payload here: the
 * log path and the echoed text are opaque data outside every guard.
 */

export type MonitorId = string;

export type MonitorStatus = "absent" | "armed" | "running" | "disarmed";
export type EffectState = "idle" | "running";
export type Terminal = "none" | "exited" | "crashed" | "timedout" | "cancelled" | "reconciled";

/** Terminals that warrant exactly one notice. */
export const ALERT_TERMINALS: readonly Terminal[] = ["crashed", "timedout", "reconciled"];

export const MONITOR_STATUSES: readonly MonitorStatus[] = ["absent", "armed", "running", "disarmed"];
export const MONITOR_TERMINALS: readonly Terminal[] = ["none", "exited", "crashed", "timedout", "cancelled", "reconciled"];

/** The finite bounds the reference model is checked under. */
export interface MonitorModelConfig {
  readonly monitors: readonly MonitorId[];
  readonly rate: number;
  readonly cap: number;
  readonly maxGen: number;
  readonly maxEmitted: number;
}

/** The verification target: one monitor, one line per window, two generations. */
export const MONITOR_MODEL: MonitorModelConfig = {
  monitors: ["m1"],
  rate: 1,
  cap: 2,
  maxGen: 3,
  maxEmitted: 4,
};

/** The complete abstract state. */
export interface AbstractMonitorState {
  readonly status: Readonly<Record<MonitorId, MonitorStatus>>;
  readonly gen: Readonly<Record<MonitorId, number>>;
  readonly effect: Readonly<Record<MonitorId, EffectState>>;
  readonly effectFence: Readonly<Record<MonitorId, number>>;
  readonly terminal: Readonly<Record<MonitorId, Terminal>>;
  readonly produced: Readonly<Record<MonitorId, number>>;
  readonly delivered: Readonly<Record<MonitorId, number>>;
  readonly queued: Readonly<Record<MonitorId, number>>;
  readonly windowAdmitted: Readonly<Record<MonitorId, number>>;
  readonly suppressed: Readonly<Record<MonitorId, number>>;
  readonly digested: Readonly<Record<MonitorId, number>>;
  readonly digestDue: Readonly<Record<MonitorId, boolean>>;
  readonly alertPending: Readonly<Record<MonitorId, boolean>>;
  readonly alertSent: Readonly<Record<MonitorId, boolean>>;
}

/** The event alphabet. `pi-crash` is global; the rest name a monitor. */
export type MonitorEvent =
  | { readonly type: "arm"; readonly monitor: MonitorId }
  | { readonly type: "admit"; readonly monitor: MonitorId }
  | { readonly type: "emit"; readonly monitor: MonitorId }
  | { readonly type: "deliver"; readonly monitor: MonitorId }
  | { readonly type: "end-window"; readonly monitor: MonitorId }
  | { readonly type: "digest"; readonly monitor: MonitorId }
  | { readonly type: "deliver-alert"; readonly monitor: MonitorId }
  | { readonly type: "exit"; readonly monitor: MonitorId }
  | { readonly type: "crash"; readonly monitor: MonitorId }
  | { readonly type: "timeout"; readonly monitor: MonitorId }
  | { readonly type: "cancel"; readonly monitor: MonitorId }
  | { readonly type: "effect-stale"; readonly monitor: MonitorId }
  | { readonly type: "reconcile"; readonly monitor: MonitorId }
  | { readonly type: "pi-crash" };

export type MonitorAction = MonitorEvent["type"];

/** Every action of the machine, in specification order. */
export const MONITOR_ACTIONS: readonly MonitorAction[] = [
  "arm",
  "admit",
  "emit",
  "deliver",
  "end-window",
  "digest",
  "deliver-alert",
  "exit",
  "crash",
  "timeout",
  "cancel",
  "effect-stale",
  "reconcile",
  "pi-crash",
];

/** Construct the initial state. */
export function initAbstractMonitorState(config: MonitorModelConfig = MONITOR_MODEL): AbstractMonitorState {
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
  for (const monitor of config.monitors) {
    status[monitor] = "absent";
    gen[monitor] = 0;
    effect[monitor] = "idle";
    effectFence[monitor] = 0;
    terminal[monitor] = "none";
    produced[monitor] = 0;
    delivered[monitor] = 0;
    queued[monitor] = 0;
    windowAdmitted[monitor] = 0;
    suppressed[monitor] = 0;
    digested[monitor] = 0;
    digestDue[monitor] = false;
    alertPending[monitor] = false;
    alertSent[monitor] = false;
  }
  return { status, gen, effect, effectFence, terminal, produced, delivered, queued, windowAdmitted, suppressed, digested, digestDue, alertPending, alertSent };
}

function set<K extends string, V>(record: Readonly<Record<K, V>>, key: K, value: V): Record<K, V> {
  return { ...record, [key]: value };
}

function setAll<K extends string, V>(keys: readonly K[], value: V): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const key of keys) out[key] = value;
  return out;
}

/** Why a model step was refused. */
export class MonitorStateError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MonitorStateError";
  }
}

/** The guards, one per action. Shared by the action and the trace validator. */
export const guards = {
  arm: (state: AbstractMonitorState, config: MonitorModelConfig, monitor: MonitorId): boolean =>
    (state.status[monitor] === "absent" || state.status[monitor] === "disarmed") &&
    (state.gen[monitor] ?? 0) < config.maxGen &&
    (state.effect[monitor] === "idle" || (state.effectFence[monitor] ?? 0) < (state.gen[monitor] ?? 0)) &&
    (state.queued[monitor] ?? 0) === 0 &&
    (state.suppressed[monitor] ?? 0) === 0 &&
    state.digestDue[monitor] !== true &&
    state.alertPending[monitor] !== true,

  admit: (state: AbstractMonitorState, monitor: MonitorId): boolean =>
    state.status[monitor] === "armed" && state.effect[monitor] === "idle",

  emit: (state: AbstractMonitorState, config: MonitorModelConfig, monitor: MonitorId): boolean =>
    state.status[monitor] === "running" &&
    state.effect[monitor] === "running" &&
    state.effectFence[monitor] === state.gen[monitor] &&
    (state.produced[monitor] ?? 0) < config.maxEmitted &&
    (state.queued[monitor] ?? 0) < config.cap,

  deliver: (state: AbstractMonitorState, monitor: MonitorId): boolean => (state.queued[monitor] ?? 0) > 0,

  "end-window": (state: AbstractMonitorState, monitor: MonitorId): boolean => state.status[monitor] !== "absent",

  digest: (state: AbstractMonitorState, monitor: MonitorId): boolean => state.digestDue[monitor] === true,

  "deliver-alert": (state: AbstractMonitorState, monitor: MonitorId): boolean => state.alertPending[monitor] === true,

  exit: (state: AbstractMonitorState, monitor: MonitorId): boolean =>
    state.status[monitor] === "running" &&
    state.effect[monitor] === "running" &&
    state.effectFence[monitor] === state.gen[monitor],

  crash: (state: AbstractMonitorState, monitor: MonitorId): boolean => guards.exit(state, monitor),
  timeout: (state: AbstractMonitorState, monitor: MonitorId): boolean => guards.exit(state, monitor),

  cancel: (state: AbstractMonitorState, config: MonitorModelConfig, monitor: MonitorId): boolean =>
    (state.status[monitor] === "armed" || state.status[monitor] === "running") && (state.gen[monitor] ?? 0) < config.maxGen,

  "effect-stale": (state: AbstractMonitorState, monitor: MonitorId): boolean =>
    state.effect[monitor] === "running" && (state.effectFence[monitor] ?? 0) < (state.gen[monitor] ?? 0),

  reconcile: (state: AbstractMonitorState, monitor: MonitorId): boolean =>
    state.status[monitor] === "running" && state.effect[monitor] === "idle",
} as const;

/** Apply one event to the abstract model. */
export function referenceReduceMonitorState(
  state: AbstractMonitorState,
  event: MonitorEvent,
  config: MonitorModelConfig = MONITOR_MODEL,
): AbstractMonitorState {
  if (event.type === "pi-crash") {
    return { ...state, effect: setAll(config.monitors, "idle" as const) };
  }
  const m = event.monitor;
  switch (event.type) {
    case "arm": {
      require(guards.arm(state, config, m), "arm-not-enabled", m);
      return {
        ...state,
        status: set(state.status, m, "armed"),
        gen: set(state.gen, m, (state.gen[m] ?? 0) + 1),
        effect: set(state.effect, m, "idle"),
        effectFence: set(state.effectFence, m, (state.gen[m] ?? 0) + 1),
        terminal: set(state.terminal, m, "none"),
        produced: set(state.produced, m, 0),
        delivered: set(state.delivered, m, 0),
        queued: set(state.queued, m, 0),
        windowAdmitted: set(state.windowAdmitted, m, 0),
        suppressed: set(state.suppressed, m, 0),
        digested: set(state.digested, m, 0),
        digestDue: set(state.digestDue, m, false),
        alertPending: set(state.alertPending, m, false),
        alertSent: set(state.alertSent, m, false),
      };
    }
    case "admit": {
      require(guards.admit(state, m), "admit-not-enabled", m);
      return {
        ...state,
        status: set(state.status, m, "running"),
        effect: set(state.effect, m, "running"),
        effectFence: set(state.effectFence, m, state.gen[m] ?? 0),
      };
    }
    case "emit": {
      require(guards.emit(state, config, m), "emit-not-enabled", m);
      const produced = (state.produced[m] ?? 0) + 1;
      if ((state.windowAdmitted[m] ?? 0) < config.rate) {
        return {
          ...state,
          produced: set(state.produced, m, produced),
          queued: set(state.queued, m, (state.queued[m] ?? 0) + 1),
          windowAdmitted: set(state.windowAdmitted, m, (state.windowAdmitted[m] ?? 0) + 1),
        };
      }
      return {
        ...state,
        produced: set(state.produced, m, produced),
        suppressed: set(state.suppressed, m, (state.suppressed[m] ?? 0) + 1),
      };
    }
    case "deliver": {
      require(guards.deliver(state, m), "deliver-not-enabled", m);
      return {
        ...state,
        delivered: set(state.delivered, m, (state.delivered[m] ?? 0) + 1),
        queued: set(state.queued, m, (state.queued[m] ?? 0) - 1),
      };
    }
    case "end-window": {
      require(guards["end-window"](state, m), "end-window-not-enabled", m);
      return {
        ...state,
        windowAdmitted: set(state.windowAdmitted, m, 0),
        digestDue: set(state.digestDue, m, state.digestDue[m] === true || (state.suppressed[m] ?? 0) > 0),
      };
    }
    case "digest": {
      require(guards.digest(state, m), "digest-not-enabled", m);
      return {
        ...state,
        digested: set(state.digested, m, (state.digested[m] ?? 0) + (state.suppressed[m] ?? 0)),
        suppressed: set(state.suppressed, m, 0),
        digestDue: set(state.digestDue, m, false),
      };
    }
    case "deliver-alert": {
      require(guards["deliver-alert"](state, m), "deliver-alert-not-enabled", m);
      return {
        ...state,
        alertSent: set(state.alertSent, m, true),
        alertPending: set(state.alertPending, m, false),
      };
    }
    case "exit":
    case "crash":
    case "timeout": {
      require(guards[event.type](state, m), `${event.type}-not-enabled`, m);
      const terminal: Terminal = event.type === "exit" ? "exited" : event.type === "crash" ? "crashed" : "timedout";
      return {
        ...state,
        status: set(state.status, m, "disarmed"),
        effect: set(state.effect, m, "idle"),
        terminal: set(state.terminal, m, terminal),
        alertPending: event.type === "exit" ? state.alertPending : set(state.alertPending, m, true),
      };
    }
    case "cancel": {
      require(guards.cancel(state, config, m), "cancel-not-enabled", m);
      return {
        ...state,
        gen: set(state.gen, m, (state.gen[m] ?? 0) + 1),
        status: set(state.status, m, "disarmed"),
        terminal: set(state.terminal, m, "cancelled"),
      };
    }
    case "effect-stale": {
      require(guards["effect-stale"](state, m), "effect-stale-not-enabled", m);
      return { ...state, effect: set(state.effect, m, "idle") };
    }
    case "reconcile": {
      require(guards.reconcile(state, m), "reconcile-not-enabled", m);
      return {
        ...state,
        status: set(state.status, m, "disarmed"),
        terminal: set(state.terminal, m, "reconciled"),
        alertPending: set(state.alertPending, m, true),
      };
    }
  }
}

function require(condition: boolean, code: string, subject: string): asserts condition {
  if (!condition) throw new MonitorStateError(code, `event not enabled: ${code} (${subject})`);
}

/** Every event enabled in a state. */
export function enabledEvents(state: AbstractMonitorState, config: MonitorModelConfig = MONITOR_MODEL): MonitorEvent[] {
  const events: MonitorEvent[] = [{ type: "pi-crash" }];
  for (const monitor of config.monitors) {
    if (guards.arm(state, config, monitor)) events.push({ type: "arm", monitor });
    if (guards.admit(state, monitor)) events.push({ type: "admit", monitor });
    if (guards.emit(state, config, monitor)) events.push({ type: "emit", monitor });
    if (guards.deliver(state, monitor)) events.push({ type: "deliver", monitor });
    if (guards["end-window"](state, monitor)) events.push({ type: "end-window", monitor });
    if (guards.digest(state, monitor)) events.push({ type: "digest", monitor });
    if (guards["deliver-alert"](state, monitor)) events.push({ type: "deliver-alert", monitor });
    if (guards.exit(state, monitor)) {
      events.push({ type: "exit", monitor });
      events.push({ type: "crash", monitor });
      events.push({ type: "timeout", monitor });
    }
    if (guards.cancel(state, config, monitor)) events.push({ type: "cancel", monitor });
    if (guards["effect-stale"](state, monitor)) events.push({ type: "effect-stale", monitor });
    if (guards.reconcile(state, monitor)) events.push({ type: "reconcile", monitor });
  }
  return events;
}

/** A single invariant failure. */
export interface MonitorViolation {
  readonly invariant: string;
  readonly detail: string;
}

/** Check every safety invariant of the abstract monitor machine. */
export function monitorInvariantViolations(state: AbstractMonitorState, config: MonitorModelConfig = MONITOR_MODEL): MonitorViolation[] {
  const out: MonitorViolation[] = [];
  const push = (invariant: string, detail: string): void => {
    out.push({ invariant, detail });
  };

  // TypeOK
  const inDomain = (value: unknown, domain: readonly unknown[]): boolean => domain.includes(value);
  for (const monitor of config.monitors) {
    if (!inDomain(state.status[monitor], MONITOR_STATUSES)) push("TypeOK", `${monitor} status ${state.status[monitor]}`);
    if (!inDomain(state.effect[monitor], ["idle", "running"])) push("TypeOK", `${monitor} effect ${state.effect[monitor]}`);
    if (!inDomain(state.terminal[monitor], MONITOR_TERMINALS)) push("TypeOK", `${monitor} terminal ${state.terminal[monitor]}`);
    const bounded = (value: number | undefined, max: number): boolean => Number.isInteger(value) && (value ?? -1) >= 0 && (value ?? Infinity) <= max;
    if (!bounded(state.gen[monitor], config.maxGen)) push("TypeOK", `${monitor} gen out of range`);
    if (!bounded(state.effectFence[monitor], config.maxGen)) push("TypeOK", `${monitor} effectFence out of range`);
    if (!bounded(state.produced[monitor], config.maxEmitted)) push("TypeOK", `${monitor} produced out of range`);
    if (!bounded(state.delivered[monitor], config.maxEmitted)) push("TypeOK", `${monitor} delivered out of range`);
    if (!bounded(state.queued[monitor], config.cap)) push("TypeOK", `${monitor} queued out of range`);
    if (!bounded(state.windowAdmitted[monitor], config.rate)) push("TypeOK", `${monitor} windowAdmitted out of range`);
    if (!bounded(state.suppressed[monitor], config.maxEmitted)) push("TypeOK", `${monitor} suppressed out of range`);
    if (!bounded(state.digested[monitor], config.maxEmitted)) push("TypeOK", `${monitor} digested out of range`);
  }

  for (const monitor of config.monitors) {
    const status = state.status[monitor];
    const gen = state.gen[monitor] ?? 0;
    const fence = state.effectFence[monitor] ?? 0;
    const effect = state.effect[monitor];
    const terminal = state.terminal[monitor];
    const queued = state.queued[monitor] ?? 0;
    const suppressed = state.suppressed[monitor] ?? 0;

    if (fence > gen) push("EffectFenceBound", `${monitor} fence ${fence} > gen ${gen}`);
    if (status === "running" && effect === "running" && fence !== gen) push("RunningEffectCurrent", `${monitor} running effect on fence ${fence}, gen ${gen}`);
    if (status === "armed" && (effect !== "idle" || fence !== gen)) push("ArmedIdle", `${monitor} armed with effect ${effect}, fence ${fence}, gen ${gen}`);
    if (effect === "running" && fence < gen && !(status === "disarmed" && terminal === "cancelled")) {
      push("StaleOnlyAfterInvalidation", `${monitor} stale effect ${fence} < ${gen} in ${status}/${terminal}`);
    }
    if (status === "disarmed" && fence === gen && effect !== "idle") push("DisarmedCurrentNoEffect", `${monitor} disarmed with current effect`);
    if (status === "running" && terminal !== "none") push("RunningHasNoTerminal", `${monitor} running is ${terminal}`);
    if ((state.produced[monitor] ?? 0) !== (state.delivered[monitor] ?? 0) + queued + suppressed + (state.digested[monitor] ?? 0)) {
      push("NoSilentLoss", `${monitor} produced ${state.produced[monitor]} != delivered+queued+suppressed+digested`);
    }
    if ((state.windowAdmitted[monitor] ?? 0) > config.rate) push("RateBound", `${monitor} windowAdmitted > rate`);
    if (queued > config.cap) push("QueueBound", `${monitor} queued > cap`);
    if (state.digestDue[monitor] === true && suppressed === 0) push("DigestSound", `${monitor} digestDue with no suppressed lines`);
    if (state.alertSent[monitor] === true && !(terminal !== undefined && ALERT_TERMINALS.includes(terminal))) {
      push("AlertSound", `${monitor} alertSent without an alert terminal (${terminal})`);
    }
    if (state.alertPending[monitor] === true && !(terminal !== undefined && ALERT_TERMINALS.includes(terminal) && state.alertSent[monitor] !== true)) {
      push("AlertPendingSound", `${monitor} alertPending without a fresh alert terminal`);
    }
  }

  return out;
}

/** Names of every invariant checked above. */
export const MONITOR_INVARIANT_NAMES: readonly string[] = [
  "TypeOK",
  "EffectFenceBound",
  "RunningEffectCurrent",
  "ArmedIdle",
  "StaleOnlyAfterInvalidation",
  "DisarmedCurrentNoEffect",
  "RunningHasNoTerminal",
  "NoSilentLoss",
  "RateBound",
  "QueueBound",
  "DigestSound",
  "AlertSound",
  "AlertPendingSound",
];

/** The accounting-law and notice-completeness invariants from MonitorView.tla. */
export function monitorViewInvariantViolations(state: AbstractMonitorState, config: MonitorModelConfig = MONITOR_MODEL): MonitorViolation[] {
  const out = [...monitorInvariantViolations(state, config)];
  for (const monitor of config.monitors) {
    const terminal = state.terminal[monitor];
    if (terminal !== undefined && ALERT_TERMINALS.includes(terminal) && state.alertPending[monitor] !== true && state.alertSent[monitor] !== true) {
      out.push({ invariant: "NoticeComplete", detail: `${monitor} terminal ${terminal} without a pending or sent notice` });
    }
  }
  return out;
}

export const MONITOR_VIEW_INVARIANT_NAMES: readonly string[] = [...MONITOR_INVARIANT_NAMES, "AccountingLaw", "NoticeComplete"];
