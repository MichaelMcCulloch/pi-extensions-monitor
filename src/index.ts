/**
 * pi extension entry point.
 *
 * The monitor is session-scoped: snapshots are `monitor/state` custom entries,
 * so branching rewinds the monitors with the session. One store per session;
 * the reducer is `referenceReduceMonitorState`, the mirror of
 * `spec/MonitorSystem.tla`.
 *
 * Active monitors are also shown persistently above the editor (finished ones
 * are counted only), and `/monitor` opens an inspector with counters and a tail
 * of each log file for active and finished monitors alike.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { renderBoard } from "./engine/projection.ts";
import { DEFAULT_MONITOR_POLICY, initMonitorState, type MonitorState } from "./engine/state.ts";
import { MonitorInjector, type OutgoingMessage } from "./extension/injector.ts";
import { MonitorRuntime } from "./extension/runtime.ts";
import { MonitorStore, type MonitorPersistence } from "./extension/store.ts";
import { MonitorSupervisor } from "./extension/supervisor.ts";
import { buildMonitorTool } from "./extension/tool.ts";
import { MonitorExplorer, MonitorWidget, hasActiveMonitors, renderMonitorDetail, renderMonitorWidget } from "./extension/hud.ts";

/** The custom-entry type that carries the complete snapshot. */
export const MONITOR_STATE_ENTRY = "monitor/state";

/** The widget slot above the editor. */
const WIDGET_KEY = "monitor-board";

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
  let currentCtx: ExtensionContext | null = null;
  let widgetTui: TUI | null = null;
  let widgetInstalled = false;

  const hideWidget = (): void => {
    if (widgetInstalled && currentCtx !== null && currentCtx.mode === "tui" && currentCtx.hasUI) {
      currentCtx.ui.setWidget(WIDGET_KEY, undefined);
    }
    widgetInstalled = false;
  };

  const refreshWidget = (): void => {
    const ctx = currentCtx;
    if (ctx === null || current === null) return;
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    if (!hasActiveMonitors(current.store.state)) {
      hideWidget();
      return;
    }
    if (!widgetInstalled) {
      ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
        widgetTui = tui;
        return new MonitorWidget(
          () => (current === null ? [] : renderMonitorWidget(current.store.state)),
          10,
          () => void openExplorer(currentCtx ?? ctx),
          () => currentCtx?.ui.theme ?? theme,
        );
      });
      widgetInstalled = true;
    }
    widgetTui?.requestRender();
  };

  const close = (): void => {
    current?.runtime.shutdown();
    current = null;
  };

  const setup = (ctx: ExtensionContext): Session => {
    const snapshot = latestSnapshot(ctx);
    const persistence: MonitorPersistence = {
      append: (state) => {
        pi.appendEntry(MONITOR_STATE_ENTRY, state);
        try { pi.events.emit("monitor/changed", {revision:state.revision}); } catch { /* Notification subscribers cannot undo durable monitor state. */ }
        refreshWidget();
      },
    };
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
    currentCtx = ctx;
    close();
    const session = setup(ctx);
    session.runtime.reconcileOnLoad();
    refreshWidget();
  });
  pi.on("session_tree", (_event, ctx) => {
    currentCtx = ctx;
    close();
    const session = setup(ctx);
    session.runtime.reconcileOnLoad();
    refreshWidget();
  });
  pi.on("agent_settled", () => current?.runtime.settle());
  pi.on("session_shutdown", () => {
    close();
    hideWidget();
    currentCtx = null;
    widgetTui = null;
  });

  pi.registerTool(buildMonitorTool((ctx) => ensure(ctx).runtime));

  const openExplorer = async (ctx: ExtensionContext): Promise<void> => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const session = ensure(ctx);
    await ctx.ui.custom<undefined>(
      (tui, theme, _keybindings, done) =>
        new MonitorExplorer(
          (width) => renderMonitorDetail(session.store.state, width),
          tui,
          () => ctx.ui.theme,
          () => done(undefined),
        ),
      { overlay: true, overlayOptions: { width: "92%", maxHeight: "92%", anchor: "center", margin: 1 } },
    );
  };

  pi.registerCommand("monitor", {
    description: "Open the monitor inspector: active monitors first, then finished ones",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        ctx.ui.notify(renderBoard(ensure(ctx).store.state), "info");
        return;
      }
      await openExplorer(ctx);
    },
  });
}
