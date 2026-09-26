import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initMonitorState } from "../src/engine/state.ts";
import { MonitorWidget, isMonitorEmpty, readLogTail, renderMonitorDetail, renderMonitorWidget } from "../src/extension/hud.ts";

function withMonitor(logPath: string): ReturnType<typeof initMonitorState> {
  const state = initMonitorState();
  return {
    ...state,
    status: { ...state.status, t: "running" },
    gen: { ...state.gen, t: 1 },
    queued: { ...state.queued, t: 2 },
    produced: { ...state.produced, t: 5 },
    delivered: { ...state.delivered, t: 3 },
    suppressed: { ...state.suppressed, t: 1 },
    specs: {
      t: { name: "t", script: "echo tick", cwd: "/tmp", timeoutMs: null, logPath, startedAt: 0, endedAt: null, exitCode: null, signal: null, detail: null },
    },
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
    expect(isMonitorEmpty(initMonitorState())).toBe(true);
    expect(renderMonitorWidget(initMonitorState())).toEqual([]);
  });

  it("shows the running monitor in the widget", () => {
    const lines = renderMonitorWidget(withMonitor(logFile(["tick"]))).join("\n");
    expect(lines).toContain("1 total");
    expect(lines).toContain("t");
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
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(visibleWidth(line)).toBe(50);
    expect(lines[1]).toContain("+2 more");
  });
});
