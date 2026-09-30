import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boot, injected, runTool, sleep, until } from "./harness.ts";

describe("monitor extension", () => {
  it("arms, injects echoed lines, and writes the full log; stderr is not injected", async () => {
    const fake = boot();
    const result = await runTool(fake, { action: "arm", name: "t", script: "echo one; echo err >&2; sleep 0.05; echo two" });
    const logPath = result.details.logPath as string;
    expect(result.content[0]!.text).toContain(logPath);
    await until(() => injected(fake).some((text) => text.includes("two")), 4000);
    const all = injected(fake).join("\n");
    expect(all).toContain("[monitor \"t\"]");
    expect(all).toContain("one");
    expect(all).toContain("two");
    expect(all).not.toContain("err");
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf8")).toContain("stderr: err");
    fake.lifecycle("session_shutdown");
  });

  it("sends exactly one crash alert for a failing script", async () => {
    const fake = boot();
    await runTool(fake, { action: "arm", name: "boom", script: "echo before; exit 3" });
    await until(() => injected(fake).some((text) => text.includes("crashed")), 4000);
    const alerts = injected(fake).filter((text) => text.includes("crashed"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("exit 3");
    fake.lifecycle("session_shutdown");
  });

  it("cancels a running monitor without a false crash alert", async () => {
    const fake = boot();
    await runTool(fake, { action: "arm", name: "loop", script: "i=0; while true; do i=$((i+1)); echo tick-$i; sleep 0.02; done" });
    await until(() => injected(fake).length > 0, 3000);
    await runTool(fake, { action: "cancel", name: "loop" });
    await sleep(200);
    fake.lifecycle("agent_settled");
    expect(injected(fake).some((text) => text.includes("crashed"))).toBe(false);
    expect(injected(fake).some((text) => text.includes("tick-"))).toBe(true);
    fake.lifecycle("session_shutdown");
  });

  it("lists armed monitors and their log paths", async () => {
    const fake = boot();
    await runTool(fake, { action: "arm", name: "listed", script: "sleep 5" });
    const listed = await runTool(fake, { action: "list" });
    expect(listed.content[0]!.text).toContain("listed");
    expect(listed.content[0]!.text).toContain("/tmp/pi-monitor-");
    await runTool(fake, { action: "cancel", name: "listed" });
    fake.lifecycle("session_shutdown");
  });

  it("clears finished monitors but never a running one", async () => {
    const fake = boot();
    await runTool(fake, { action: "arm", name: "oneshot", script: "echo done" });
    await until(
      () => (fake.entries.at(-1)?.data as { status?: Record<string, string> } | undefined)?.status?.["oneshot"] === "disarmed",
      4000,
    );
    await expect(runTool(fake, { action: "cancel", name: "oneshot" })).rejects.toThrow(/action=clear/);
    await runTool(fake, { action: "arm", name: "forever", script: "sleep 5" });
    const cleared = await runTool(fake, { action: "clear" });
    expect(cleared.content[0]!.text).toContain("cleared 1 monitor(s): oneshot");
    expect(cleared.content[0]!.text).toContain("kept 1 still active or settling: forever");
    const snapshot = fake.entries.at(-1)!.data as { specs: Record<string, unknown> };
    expect(snapshot.specs["oneshot"]).toBeUndefined();
    expect(snapshot.specs["forever"]).toBeDefined();
    await expect(runTool(fake, { action: "clear", name: "forever" })).rejects.toThrow(/monitor-clear-active/);
    await runTool(fake, { action: "cancel", name: "forever" });
    fake.lifecycle("session_shutdown");
  });

  it("surfaces a refusal as a thrown tool error so the agent sees the fault", async () => {
    const fake = boot();
    // Returning the refusal as content would be recorded as a successful call
    // (`isError: false`); throwing is the only way to signal failure.
    await expect(runTool(fake, { action: "arm", name: "Bad Name", script: "echo hi" })).rejects.toThrow(
      /monitor-invalid-name/,
    );
    await expect(runTool(fake, { action: "arm", name: "armless" })).rejects.toThrow(/monitor-missing-script/);
    fake.lifecycle("session_shutdown");
  });
});
