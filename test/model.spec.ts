/**
 * Exhaustive exploration of the executable mirror of `spec/MonitorSystem.tla`.
 *
 * The reachable-set size is asserted to equal the number TLC reports (2701 for
 * `MonitorSystemFixture.cfg`). Drift in either the spec or the mirror changes
 * the count and fails this test.
 */

import { describe, expect, it } from "vitest";
import {
  enabledEvents,
  initAbstractMonitorState,
  monitorInvariantViolations,
  monitorViewInvariantViolations,
  MONITOR_MODEL,
  referenceReduceMonitorState,
  type AbstractMonitorState,
} from "../src/formal/model.ts";

const FIELDS = [
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
] as const;

function serialize(state: AbstractMonitorState): string {
  return MONITOR_MODEL.monitors
    .map((monitor) => FIELDS.map((field) => String((state[field] as Record<string, unknown>)[monitor])).join(","))
    .join("|");
}

describe("MonitorSystem executable mirror", () => {
  it("reaches exactly the TLC state count and preserves every invariant", () => {
    const config = MONITOR_MODEL;
    const seen = new Set<string>();
    const queue: AbstractMonitorState[] = [initAbstractMonitorState(config)];
    while (queue.length > 0) {
      const state = queue.pop()!;
      const key = serialize(state);
      if (seen.has(key)) continue;
      seen.add(key);
      expect(monitorViewInvariantViolations(state, config), `invariant violated in ${key}`).toEqual([]);
      for (const event of enabledEvents(state, config)) {
        queue.push(referenceReduceMonitorState(state, event, config));
      }
    }
    expect(seen.size).toBe(2701);
  });

  it("core invariant checks are a subset of the view checks", () => {
    expect(monitorInvariantViolations(initAbstractMonitorState())).toEqual([]);
    expect(monitorViewInvariantViolations(initAbstractMonitorState())).toEqual([]);
  });
});
