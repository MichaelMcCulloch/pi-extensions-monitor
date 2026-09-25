/**
 * Production invariant diagnostics.
 *
 * The structural core is exactly `monitorInvariantViolations` (and the view
 * checks) — the same properties TLC proves over the fixture. Two
 * production-strength conditions are added: every non-absent monitor carries a
 * spec with a log path, and the revision is a non-negative integer. The store
 * refuses to persist any state that violates them.
 */

import { monitorViewInvariantViolations, type MonitorViolation } from "../formal/model.ts";
import { abstractMonitorState, monitorIds, monitorModelConfig, type MonitorPolicy, type MonitorState } from "./state.ts";

/** Check every safety invariant of the durable monitor state. */
export function verifyMonitorState(state: MonitorState, policy: MonitorPolicy): MonitorViolation[] {
  const ids = monitorIds(state);
  const violations = [...monitorViewInvariantViolations(abstractMonitorState(state, ids), monitorModelConfig(policy, ids))];
  const push = (invariant: string, detail: string): void => {
    violations.push({ invariant, detail });
  };
  for (const monitor of ids) {
    const status = state.status[monitor] ?? "absent";
    if (status !== "absent") {
      const spec = state.specs[monitor];
      if (spec === undefined) push("SpecPresent", `${monitor} is ${status} without a spec`);
      else if (spec.logPath.length === 0) push("LogPathPresent", `${monitor} has an empty log path`);
    }
  }
  if (!Number.isInteger(state.revision) || state.revision < 0) push("RevisionNonNegative", `revision ${state.revision}`);
  return violations;
}

/** Every invariant name enforced in production. */
export const MONITOR_PRODUCTION_INVARIANTS: readonly string[] = [
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
  "AccountingLaw",
  "NoticeComplete",
  "SpecPresent",
  "LogPathPresent",
  "RevisionNonNegative",
];
