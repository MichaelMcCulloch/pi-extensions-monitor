/**
 * pi extension entry point.
 *
 * The monitor is session-scoped: snapshots are `monitor/state` custom entries,
 * so branching rewinds the monitors with the session. One store per session;
 * the reducer is `referenceReduceMonitorState`, the mirror of
 * `spec/MonitorSystem.tla`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderBoard } from "./engine/projection.ts";
import { DEFAULT_MONITOR_POLICY, initMonitorState, type MonitorState } from "./engine/state.ts";
import { MonitorInjector, type OutgoingMessage } from "./extension/injector.ts";
import { MonitorRuntime } from "./extension/runtime.ts";
import { MonitorStore, type MonitorPersistence } from "./extension/store.ts";
import { MonitorSupervisor } from "./extension/supervisor.ts";
import { buildMonitorTool } from "./extension/tool.ts";

/** The custom-entry type that carries the complete snapshot. */
export const MONITOR_STATE_ENTRY = "monitor/state";

/** Fold the newest persisted monitor snapshot out of a session branch. */
export function latestSnapshot(ctx: ExtensionContext): MonitorState | null {
  let latest: MonitorState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === MONITOR_STATE_ENTRY && entry.data !== undefined) {
      latest = entry.data as MonitorState;
    }
  }
  return latest;
}

interface Session {
  readonly store: MonitorStore;
  readonly supervisor: MonitorSupervisor;
  readonly injector: MonitorInjector;
  readonly runtime: MonitorRuntime;
}

/** Default export consumed by pi. */
export default function monitorExtension(pi: ExtensionAPI): void {
  let current: Session | null = null;

  const close = (): void => {
    current?.runtime.shutdown();
    current = null;
  };

  const setup = (ctx: ExtensionContext): Session => {
    const snapshot = latestSnapshot(ctx);
    const persistence: MonitorPersistence = { append: (state) => pi.appendEntry(MONITOR_STATE_ENTRY, state) };
    const store = new MonitorStore(persistence, snapshot ?? initMonitorState(), DEFAULT_MONITOR_POLICY);
    const supervisor = new MonitorSupervisor();
    const send = (outgoing: OutgoingMessage): void => pi.sendMessage(outgoing.message, outgoing.options);
    const injector = new MonitorInjector({
      events: pi.events,
      store,
      send,
      backpressure: { pause: (name) => supervisor.pause(name), resume: (name) => supervisor.resume(name) },
    });
    injector.start();
    const runtime = new MonitorRuntime({
      store,
      supervisor,
      injector,
      events: pi.events,
      send,
      ...(process.env["PI_MONITOR_LOG_DIR"] === undefined ? {} : { logDir: process.env["PI_MONITOR_LOG_DIR"] }),
    });
    current = { store, supervisor, injector, runtime };
    return current;
  };

  const ensure = (ctx: ExtensionContext): Session => current ?? setup(ctx);

  pi.on("session_start", (_event, ctx) => {
    close();
    const session = setup(ctx);
    session.runtime.reconcileOnLoad();
  });
  pi.on("session_tree", (_event, ctx) => {
    close();
    const session = setup(ctx);
    session.runtime.reconcileOnLoad();
  });
  pi.on("agent_settled", () => current?.runtime.settle());
  pi.on("session_shutdown", () => close());

  pi.registerTool(buildMonitorTool((ctx) => ensure(ctx).runtime));

  pi.registerCommand("monitor", {
    description: "Show the armed monitors",
    handler: async (_args, ctx) => {
      ctx.ui.notify(renderBoard(ensure(ctx).store.state), "info");
    },
  });
}
