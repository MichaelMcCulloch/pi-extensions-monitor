/**
 * Terminal presentation for monitors.
 *
 * The persistent widget is the existing verified board. `/monitor` opens an
 * inspector that adds the opaque payload the board deliberately omits: the
 * script, cwd, counters, and a tail of each monitor's log file.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import { glyph, lifecycleLabel, renderBoard } from "../engine/projection.ts";
import type { MonitorState } from "../engine/state.ts";

/** True when no monitor has ever been armed. */
export function isMonitorEmpty(state: MonitorState): boolean {
  return Object.keys(state.specs).length === 0;
}

/** The persistent widget: the verified board, unchanged. */
export function renderMonitorWidget(state: MonitorState): string[] {
  if (isMonitorEmpty(state)) return [];
  return renderBoard(state).split("\n");
}

/** Read the last `maxLines` lines of a file, bounded by `maxBytes`. */
export function readLogTail(path: string, maxLines: number, maxBytes = 8_192): string[] {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length === 0) return [];
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, "r");
    try {
      readSync(fd, buffer, 0, length, start);
    } finally {
      closeSync(fd);
    }
    const lines = buffer.toString("utf8").split("\n");
    // A bounded read can begin mid-line; drop that partial first line.
    if (start > 0) lines.shift();
    return lines.filter((line) => line.length > 0).slice(-maxLines);
  } catch {
    return [];
  }
}

/** The full inspector body: lifecycle, counters, script, and a log tail. */
export function renderMonitorDetail(state: MonitorState, width: number): string[] {
  const monitors = [...Object.keys(state.specs)].sort();
  const abstract = state as unknown as MonitorState;
  const wrap = Math.max(20, width - 4);
  if (monitors.length === 0) return ["no monitors armed — use the monitor tool to arm one"];
  const lines: string[] = [];
  for (const monitor of monitors) {
    const spec = state.specs[monitor]!;
    lines.push(`${glyph(abstract, monitor)} ${monitor}  [${lifecycleLabel(abstract, monitor, spec.timeoutMs)}]`);
    lines.push(
      `    queued ${abstract.queued[monitor] ?? 0} · produced ${abstract.produced[monitor] ?? 0} · delivered ${abstract.delivered[monitor] ?? 0} · suppressed ${abstract.suppressed[monitor] ?? 0}`,
    );
    for (const wrapped of wrapTextWithAnsi(`script: ${spec.script}`, wrap)) lines.push(`    ${wrapped}`);
    lines.push(`    cwd: ${spec.cwd}`);
    lines.push(`    log: ${spec.logPath}`);
    if (spec.endedAt !== null) lines.push(`    ended: ${new Date(spec.endedAt).toISOString()}${spec.exitCode === null ? "" : ` · exit ${spec.exitCode}`}`);
    const tail = readLogTail(spec.logPath, 12);
    if (tail.length > 0) {
      lines.push("    tail:");
      for (const line of tail) lines.push(`      ${line}`);
    }
    lines.push("");
  }
  return lines;
}

/** The persistent widget. `lines` is read on every render so it is always live. */
export class MonitorWidget implements Component {
  public constructor(
    private readonly lines: () => string[],
    private readonly maxLines = 10,
  ) {}

  public invalidate(): void {
    // Rendering reads the live state each frame.
  }

  public render(width: number): string[] {
    const body = this.lines();
    if (body.length === 0) return [];
    const shown = body.slice(0, this.maxLines);
    if (body.length > this.maxLines) shown.push(`… +${body.length - this.maxLines} more — /monitor`);
    return shown.map((line) => truncateToWidth(line, width, "…", true));
  }
}

/** The scrollable `/monitor` inspector overlay. */
export class MonitorExplorer implements Component {
  #scroll = 0;
  #total = 0;

  public constructor(
    private readonly body: (width: number) => string[],
    private readonly tui: TUI,
    private readonly getTheme: () => Theme,
    private readonly done: () => void,
  ) {}

  public invalidate(): void {
    // The body is recomputed from the live state each render.
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c") || matchesKey(data, "q")) {
      this.done();
      return;
    }
    if (matchesKey(data, Key.up)) this.#scroll -= 1;
    else if (matchesKey(data, Key.down)) this.#scroll += 1;
    else if (matchesKey(data, Key.pageUp)) this.#scroll -= this.#viewport();
    else if (matchesKey(data, Key.pageDown)) this.#scroll += this.#viewport();
    else if (matchesKey(data, Key.home)) this.#scroll = 0;
    else if (matchesKey(data, Key.end)) this.#scroll = Number.MAX_SAFE_INTEGER;
    this.#clamp();
    this.tui.requestRender();
  }

  public render(width: number): string[] {
    const theme = this.getTheme();
    const lines: string[] = [];
    lines.push(truncateToWidth(theme.bold(theme.fg("accent", "Monitors")) + theme.fg("dim", "   ↑/↓ scroll · q close"), width, "…", true));
    lines.push(theme.fg("borderMuted", "─".repeat(Math.max(0, width))));
    const body = this.body(Math.max(20, width - 2));
    this.#total = body.length;
    this.#clamp();
    const viewport = this.#viewport();
    const end = Math.min(body.length, this.#scroll + viewport);
    for (let i = this.#scroll; i < end; i++) lines.push(truncateToWidth(body[i] ?? "", width, "…", true));
    for (let i = end - this.#scroll; i < viewport; i++) lines.push(" ".repeat(Math.max(0, width)));
    lines.push(theme.fg("borderMuted", "─".repeat(Math.max(0, width))));
    const range = body.length === 0 ? "0/0" : `${this.#scroll + 1}-${end}/${body.length}`;
    lines.push(truncateToWidth(theme.fg("dim", range), width, "…", true));
    return lines;
  }

  #viewport(): number {
    return Math.max(3, this.tui.terminal.rows - 6);
  }

  #clamp(): void {
    const max = Math.max(0, this.#total - this.#viewport());
    if (this.#scroll < 0) this.#scroll = 0;
    else if (this.#scroll > max) this.#scroll = max;
  }
}
