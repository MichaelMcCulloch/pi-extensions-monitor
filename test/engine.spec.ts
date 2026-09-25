import { describe, expect, it } from "vitest";
import { DEFAULT_MONITOR_POLICY } from "../src/engine/state.ts";
import { memoryMonitorStore } from "../src/extension/store.ts";

const policy = { ...DEFAULT_MONITOR_POLICY, rate: 1, cap: 2 };

function armed(script = "echo x") {
  const store = memoryMonitorStore(policy);
  store.arm({ monitor: "m1", script, cwd: "/tmp", timeoutMs: null, logPath: "/tmp/pi-monitor-m1.log" });
  return store;
}

describe("monitor engine", () => {
  it("arms, admits, admits one line, suppresses the rest, and digests", () => {
    const store = armed();
    expect(store.state.status["m1"]).toBe("armed");
    store.admit("m1");
    expect(store.state.status["m1"]).toBe("running");
    expect(store.emit("m1").admitted).toBe(true);
    expect(store.emit("m1").admitted).toBe(false);
    expect(store.state.queued["m1"]).toBe(1);
    expect(store.state.suppressed["m1"]).toBe(1);
    expect(store.state.produced["m1"]).toBe(2);
    store.endWindow("m1");
    expect(store.state.digestDue["m1"]).toBe(true);
    expect(store.digest("m1").digested).toBe(1);
    expect(store.state.digested["m1"]).toBe(1);
    expect(store.violations()).toEqual([]);
  });

  it("fences a cancel so a late effect is stale and a re-arm succeeds", () => {
    const store = armed("loop");
    store.admit("m1");
    store.cancel("m1");
    expect(store.state.status["m1"]).toBe("disarmed");
    expect(store.state.terminal["m1"]).toBe("cancelled");
    expect(store.state.effect["m1"]).toBe("running");
    expect(store.state.effectFence["m1"]).toBeLessThan(store.state.gen["m1"]!);
    store.effectStale("m1");
    expect(store.state.effect["m1"]).toBe("idle");
    store.arm({ monitor: "m1", script: "again", cwd: "/tmp", timeoutMs: null, logPath: "/tmp/pi-monitor-m1b.log" });
    expect(store.state.status["m1"]).toBe("armed");
    expect(store.violations()).toEqual([]);
  });

  it("crashes with exactly one alert and disarms", () => {
    const store = armed("false");
    store.admit("m1");
    store.crash("m1", "exit 1", 1, null);
    expect(store.state.terminal["m1"]).toBe("crashed");
    expect(store.state.alertPending["m1"]).toBe(true);
    store.deliverAlert("m1");
    expect(store.state.alertSent["m1"]).toBe(true);
    expect(store.state.alertPending["m1"]).toBe(false);
    expect(store.violations()).toEqual([]);
  });

  it("rejects a re-arm while the ledger has not settled", () => {
    const store = armed();
    store.admit("m1");
    store.emit("m1"); // queued = 1
    store.crash("m1", "exit 1", 1, null);
    expect(() =>
      store.arm({ monitor: "m1", script: "again", cwd: "/tmp", timeoutMs: null, logPath: "/tmp/pi-monitor-m1c.log" }),
    ).toThrowError(/monitor-transition-refused/);
  });

  it("reconciles a running monitor after pi crashes", () => {
    const store = armed("long");
    store.admit("m1");
    store.piCrash();
    expect(store.state.effect["m1"]).toBe("idle");
    store.reconcile("m1", "was running when pi exited");
    expect(store.state.terminal["m1"]).toBe("reconciled");
    expect(store.state.alertPending["m1"]).toBe(true);
    expect(store.violations()).toEqual([]);
  });

  it("refuses an unknown cancel with a stable code", () => {
    const store = armed();
    expect(() => store.cancel("nope")).toThrowError(/monitor-transition-refused/);
  });
});
