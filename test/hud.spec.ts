import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initMonitorState, type MonitorSpecRecord, type MonitorState } from "../src/engine/state.ts";
import { MonitorWidget, hasActiveMonitors, readLogTail, renderMonitorDetail, renderMonitorWidget } from "../src/extension/hud.ts";

function record(name: string, logPath: string, script = `echo ${name}`): MonitorSpecRecord {
  return { name, script, cwd: "/tmp", timeoutMs: null, logPath, startedAt: 0, endedAt: null, exitCode: null, signal: null, detail: null };
}

function withMonitor(logPath: string): MonitorState {
  const state = initMonitorState();
  return {
    ...state,
    status: { ...state.status, t: "running" },
    gen: { ...state.gen, t: 1 },
    queued: { ...state.queued, t: 2 },
    produced: { ...state.produced, t: 5 },
    delivered: { ...state.delivered, t: 3 },
    suppressed: { ...state.suppressed, t: 1 },
    specs: { t: record("t", logPath, "echo tick") },
  };
}

/** One running monitor (`t`) and one finished monitor (`f`). */
function mixedState(logPath: string): MonitorState {
  const state = initMonitorState();
  return {
    ...state,
    status: { t: "running", f: "disarmed" },
    gen: { t: 1, f: 1 },
    terminal: { t: "none", f: "exited" },
    specs: { t: record("t", logPath, "echo tick"), f: record("f", logPath) },
  };
}

describe("monitor hud renderers", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function logFile(lines: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), "monitor-hud-"));
    dirs.push(dir);
    const path = join(dir, "monitor.log");
    writeFileSync(path, lines.join("\n"));
    return path;
  }

  it("treats a fresh state as empty and hides the widget", () => {
    expect(hasActiveMonitors(initMonitorState())).toBe(false);
    expect(renderMonitorWidget(initMonitorState())).toEqual([]);
  });

  it("shows only 📟 names in the widget, not the script or log", () => {
    const logPath = logFile(["tick"]);
    const lines = renderMonitorWidget(withMonitor(logPath)).join("\n");
    expect(lines).toContain("1 active");
    expect(lines).toContain("📟 t");
    expect(lines).not.toContain("echo tick");
    expect(lines).not.toContain(logPath);
  });

  it("lists only active monitors in the widget and hides it once they all finish", () => {
    const logPath = logFile(["tick"]);
    const mixed = mixedState(logPath);
    expect(renderMonitorWidget(mixed)).toEqual(["monitor: 1 active · 1 finished", "📟 t"]);
    expect(hasActiveMonitors(mixed)).toBe(true);
    expect(hasActiveMonitors(initMonitorState())).toBe(false);
    expect(renderMonitorWidget({ ...mixed, status: { t: "disarmed", f: "disarmed" } })).toEqual([]);
  });

  it("groups active and finished monitors in the inspector", () => {
    const detail = renderMonitorDetail(mixedState(logFile(["tick"])), 80).join("\n");
    expect(detail).toContain("active (1)");
    expect(detail).toContain("finished (1) — clear with monitor action=clear");
  });

  it("includes counters and a log tail in the inspector", () => {
    const detail = renderMonitorDetail(withMonitor(logFile(["first", "second", "third"])), 80).join("\n");
    expect(detail).toContain("queued 2");
    expect(detail).toContain("produced 5");
    expect(detail).toContain("script: echo tick");
    expect(detail).toContain("tail:");
    expect(detail).toContain("third");
  });

  it("reads only the last lines of a log", () => {
    const path = logFile(Array.from({ length: 40 }, (_value, index) => `line-${index}`));
    const tail = readLogTail(path, 3);
    expect(tail).toEqual(["line-37", "line-38", "line-39"]);
  });

  it("returns no tail for a missing log", () => {
    expect(readLogTail(join(tmpdir(), "missing-monitor.log"), 5)).toEqual([]);
  });
});

describe("MonitorWidget", () => {
  it("fits lines and caps with a hint", () => {
    const widget = new MonitorWidget(() => ["one", "two", "three"], 1);
    const lines = widget.render(50);
    // separator + one kept + omission hint
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(visibleWidth(line)).toBe(50);
    expect(lines[2]).toContain("+2 more");
  });

  it("activates on a left click", () => {
    let clicks = 0;
    const widget = new MonitorWidget(() => ["one"], 10, () => {
      clicks += 1;
    });
    const event = { type: "click", button: "left", x: 1, y: 1, screenX: 1, screenY: 1, width: 50, height: 1, shift: false, alt: false, ctrl: false } as const;
    expect(widget.handleMouse(event)).toEqual({ handled: true });
    expect(clicks).toBe(1);
  });
});
