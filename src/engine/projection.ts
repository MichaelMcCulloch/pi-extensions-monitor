/**
 * The presentation layer. Everything here is a pure function of the verified
 * state: the status glyph, the terminal label, and the board. The log path and
 * the echoed text are opaque payload; they are displayed, never interpreted.
 */

import type { AbstractMonitorState, MonitorId, Terminal } from "../formal/model.ts";
import type { MonitorState } from "./state.ts";

const GLYPH: Readonly<Record<"absent" | "armed" | "running" | "disarmed", string>> = {
  absent: "·",
  armed: "◌",
  running: "▶",
  disarmed: "○",
};

const TERMINAL_GLYPH: Readonly<Record<Terminal, string>> = {
  none: "",
  exited: "✓",
  crashed: "✗",
  timedout: "⏱",
  cancelled: "⊘",
  reconciled: "⚠",
};

/** The glyph for a monitor: a status mark, refined by the terminal kind. */
export function glyph(abstract: AbstractMonitorState, monitor: MonitorId): string {
  const status = abstract.status[monitor] ?? "absent";
  if (status === "disarmed") {
    const terminal = abstract.terminal[monitor] ?? "none";
    return terminal === "none" || terminal === "exited" ? GLYPH.disarmed : TERMINAL_GLYPH[terminal];
  }
  return GLYPH[status];
}

/** A one-line lifecycle label. */
export function lifecycleLabel(abstract: AbstractMonitorState, monitor: MonitorId, timeoutMs: number | null): string {
  const status = abstract.status[monitor] ?? "absent";
  const terminal = abstract.terminal[monitor] ?? "none";
  const gen = abstract.gen[monitor] ?? 0;
  if (status === "armed") return `armed (gen ${gen})`;
  if (status === "running") return timeoutMs === null ? `running (gen ${gen})` : `running (gen ${gen}, timeout ${timeoutMs}ms)`;
  if (status === "absent") return "absent";
  const suffix = terminal === "none" ? "disarmed" : terminal;
  return `${suffix} (gen ${gen})`;
}

/** Render the board: a total function of the durable state. */
export function renderBoard(state: MonitorState): string {
  const monitors = [...Object.keys(state.specs)].sort();
  if (monitors.length === 0) return "monitor: no monitors armed";
  const abstract = state as unknown as AbstractMonitorState;
  const running = monitors.filter((monitor) => (abstract.status[monitor] ?? "absent") === "running").length;
  const lines = [`monitor: ${monitors.length} total · ${running} running`];
  for (const monitor of monitors) {
    const spec = state.specs[monitor]!;
    const queued = abstract.queued[monitor] ?? 0;
    const pending = abstract.alertPending[monitor] ? " · notice pending" : "";
    lines.push(`  ${glyph(abstract, monitor)} ${monitor}  [${lifecycleLabel(abstract, monitor, spec.timeoutMs)}] · ${queued} queued${pending}`);
    lines.push(`      ${spec.script}`);
    lines.push(`      log: ${spec.logPath}`);
  }
  return lines.join("\n");
}
