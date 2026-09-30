import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MONITOR_ACTIONS, MONITOR_INVARIANT_NAMES, MONITOR_VIEW_INVARIANT_NAMES } from "../src/formal/model.ts";

const TLA_NAME: Record<string, string> = {
  arm: "Arm",
  admit: "Admit",
  emit: "Emit",
  deliver: "Deliver",
  "end-window": "EndWindow",
  digest: "Digest",
  "deliver-alert": "DeliverAlert",
  exit: "Exit",
  crash: "Crash",
  timeout: "Timeout",
  cancel: "Cancel",
  "effect-stale": "EffectStale",
  reconcile: "Reconcile",
  clear: "Clear",
  "pi-crash": "PiCrash",
};

const GUARD_NAME: Record<string, string> = {
  arm: "GuardArm",
  admit: "GuardAdmit",
  emit: "GuardEmit",
  deliver: "GuardDeliver",
  "end-window": "GuardEndWindow",
  digest: "GuardDigest",
  "deliver-alert": "GuardDeliverAlert",
  exit: "GuardExit",
  crash: "GuardCrash",
  timeout: "GuardTimeout",
  cancel: "GuardCancel",
  "effect-stale": "GuardEffectStale",
  reconcile: "GuardReconcile",
  clear: "GuardClear",
};

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../spec/${name}`, import.meta.url)), "utf8");
}

describe("TLA+ / TypeScript parity", () => {
  const system = read("MonitorSystem.tla");
  const view = read("MonitorView.tla");

  it("the spec's Next lists exactly the model actions", () => {
    const block = system.slice(system.indexOf("Next =="), system.indexOf("Spec =="));
    const expected = new Set(Object.values(TLA_NAME));
    const found = new Set<string>();
    for (const match of block.matchAll(/\b([A-Z][A-Za-z]+)\b/g)) {
      if (expected.has(match[1]!)) found.add(match[1]!);
    }
    expect([...found].sort()).toEqual([...expected].sort());
  });

  it("every action names the expected TLA+ action and guard", () => {
    for (const action of MONITOR_ACTIONS) {
      const name = TLA_NAME[action]!;
      // `PiCrash` is a global action with no monitor argument, so no parentheses.
      const probe = name === "PiCrash" ? name : `${name}(`;
      expect(system, `missing action ${name}`).toContain(probe);
      const guard = GUARD_NAME[action];
      if (guard !== undefined) expect(system, `missing guard ${guard}`).toContain(`${guard}(`);
    }
  });

  it("every invariant is defined in the spec", () => {
    for (const invariant of MONITOR_INVARIANT_NAMES) {
      expect(system, `missing ${invariant}`).toContain(`${invariant} ==`);
    }
    for (const invariant of MONITOR_VIEW_INVARIANT_NAMES) {
      const defined = system.includes(`${invariant} ==`) || view.includes(`${invariant} ==`);
      expect(defined, `missing ${invariant}`).toBe(true);
    }
  });

  it("the executable model and the spec name the same statuses and terminals", () => {
    for (const word of ["absent", "armed", "running", "disarmed", "exited", "crashed", "timedout", "cancelled", "reconciled"]) {
      expect(system).toContain(`"${word}"`);
    }
  });
});
