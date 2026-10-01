/**
 * The model-facing `monitor` tool.
 *
 * One tool, an action discriminator, sequential execution because the store is
 * a single-writer. The list renders exactly the verified projection; `arm`
 * returns the log path the presentation already shows.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderBoard } from "../engine/projection.ts";
import type { MonitorRuntime } from "./runtime.ts";
import { MonitorRuntimeError } from "./runtime.ts";

export const MONITOR_ACTIONS = ["arm", "cancel", "clear", "list", "status"] as const;

const MonitorParams = Type.Object({
  action: StringEnum(MONITOR_ACTIONS),
  name: Type.Optional(Type.String({ description: "Monitor name; the tag on every injected line. Required by arm and cancel; optional for clear (omit to clear every finished monitor)." })),
  script: Type.Optional(Type.String({ description: "Shell script to run. Its stdout lines are injected; exiting disarms it." })),
  timeout_ms: Type.Optional(Type.Integer({ description: "Optional; on expiry the monitor alerts and disarms." })),
  cwd: Type.Optional(Type.String({ description: "Working directory (defaults to the session cwd)." })),
});

interface MonitorDetails {
  readonly action: string;
  readonly name?: string;
  readonly gen?: number;
  readonly logPath?: string;
  readonly cleared?: readonly string[];
  readonly kept?: readonly string[];
  readonly board: string;
}

export function buildMonitorTool(getRuntime: (ctx: ExtensionContext) => MonitorRuntime): ToolDefinition<typeof MonitorParams, MonitorDetails> {
  return {
    namespace: { name: "monitor", description: "Supervised background scripts and bounded notifications" },
    name: "monitor",
    label: "Monitor",
    description:
      "Arm a named background shell monitor. Every line the script prints to stdout is injected into the conversation tagged with the monitor name, delivered as a steer if you are busy. When the script exits the monitor disarms itself; if it crashes or times out you get one alert. The complete stdout/stderr log is written to a file whose path arm returns. Recurring alerts are just a loop in the script; output is rate-limited, with a digest pointing at the log if it floods. Finished monitors stay listed until you clear them.",
    promptSnippet: "monitor: arm a named background script whose stdout is injected into the conversation",
    promptGuidelines: [
      "Use monitor action=arm with a stable name and a script; the script prints what happened and exits when it is done.",
      "For recurring alerts, write a loop in the script; each printed line is injected (rate-limited with a digest on floods).",
      "Keep the log path returned by arm: the whole output is there if a digest or crash tells you to look.",
      "Use monitor action=cancel to stop one, and action=list to see what is running.",
      "Use monitor action=clear to forget finished monitors (all of them when name is omitted); it never touches a running monitor, and the log files remain on disk.",
    ],
    parameters: MonitorParams,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<{ content: { type: "text"; text: string }[]; details: MonitorDetails }> {
      const runtime = getRuntime(ctx);
      const board = (): string => renderBoard(runtime.store.state);
      try {
        if (params.action === "list" || params.action === "status") {
          return { content: [{ type: "text", text: board() }], details: { action: params.action, board: board() } };
        }
        if (params.action === "cancel") {
          if (params.name === undefined) throw new MonitorRuntimeError("monitor-missing-name", "cancel requires name");
          const spec = runtime.cancel(params.name);
          return {
            content: [{ type: "text", text: `monitor "${spec.name}" cancelled\n${board()}` }],
            details: { action: "cancel", name: spec.name, logPath: spec.logPath, board: board() },
          };
        }
        if (params.action === "clear") {
          const outcome = runtime.clear(params.name);
          const parts: string[] = [
            outcome.cleared.length === 0
              ? "no finished monitors to clear"
              : `cleared ${outcome.cleared.length} monitor(s): ${outcome.cleared.join(", ")}`,
          ];
          if (outcome.kept.length > 0) {
            parts.push(`kept ${outcome.kept.length} still active or settling: ${outcome.kept.join(", ")}`);
          }
          return {
            content: [{ type: "text", text: `${parts.join("\n")}\n${board()}` }],
            details: { action: "clear", cleared: outcome.cleared, kept: outcome.kept, board: board() },
          };
        }
        if (params.name === undefined) throw new MonitorRuntimeError("monitor-missing-name", "arm requires name");
        if (params.script === undefined) throw new MonitorRuntimeError("monitor-missing-script", "arm requires script");
        const spec = runtime.arm({
          name: params.name,
          script: params.script,
          cwd: params.cwd ?? ctx.cwd,
          timeoutMs: params.timeout_ms ?? null,
        });
        return {
          content: [
            {
              type: "text",
              text: `monitor "${spec.name}" armed\nfull log: ${spec.logPath}\n${board()}`,
            },
          ],
          details: { action: "arm", name: spec.name, logPath: spec.logPath, board: board() },
        };
      } catch (error) {
        if (error instanceof MonitorRuntimeError) {
          // The agent runtime only marks a tool result as an error when
          // `execute` throws; a refusal returned as ordinary content is
          // reported to the model as success. Rethrow with the action and the
          // stable code so the failure is visible and actionable.
          throw new MonitorRuntimeError(
            error.code,
            `monitor ${params.action} refused (${error.code}): ${error.message}`,
          );
        }
        throw error;
      }
    },
  };
}
