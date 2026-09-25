/**
 * A fake `pi` and `ctx` good enough to drive the real extension with real child
 * processes. Only the surface the monitor extension touches is implemented.
 */

import { EventEmitter } from "node:events";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import monitorExtension from "../src/index.ts";

export interface Sent {
  readonly message: { customType: string; content: string; display: boolean; details: unknown };
  readonly options: { triggerTurn?: boolean; deliverAs?: string };
}

export interface FakePi {
  pi: Record<string, unknown>;
  ctx: ExtensionContext;
  sent: Sent[];
  entries: Array<{ type: "custom"; customType: string; data: unknown }>;
  tools: Map<string, any>;
  lifecycle(event: string): void;
}

export function createFakePi(): FakePi {
  const emitter = new EventEmitter();
  const lifecycleHandlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
  const sent: Sent[] = [];
  const entries: FakePi["entries"] = [];
  const tools = new Map<string, any>();
  const state = { sent, entries, tools } as unknown as FakePi;
  const bus = {
    emit: (channel: string, data: unknown) => emitter.emit(channel, data),
    on: (channel: string, handler: (data: unknown) => void) => {
      emitter.on(channel, handler);
      return () => emitter.off(channel, handler);
    },
  };
  const ctx = {
    cwd: process.cwd(),
    mode: "tui",
    hasUI: false,
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
    ui: { notify: () => {} },
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionContext;
  const pi = {
    events: bus,
    on: (event: string, handler: (e: unknown, c: ExtensionContext) => void) => {
      const list = lifecycleHandlers.get(event) ?? [];
      list.push(handler);
      lifecycleHandlers.set(event, list);
    },
    registerTool: (definition: any) => tools.set(definition.name, definition),
    registerCommand: () => {},
    sendMessage: (message: Sent["message"], options: Sent["options"]) => sent.push({ message, options }),
    sendUserMessage: () => {},
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
    exec: async () => {
      throw new Error("exec not used");
    },
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getCommands: () => [],
    setModel: async () => true,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
    registerProvider: () => {},
    unregisterProvider: () => {},
  };
  state.pi = pi;
  state.ctx = ctx;
  state.sent = sent;
  state.entries = entries;
  state.tools = tools;
  state.lifecycle = (event: string) => {
    for (const handler of lifecycleHandlers.get(event) ?? []) handler({}, ctx);
  };
  return state;
}

export function boot(): FakePi {
  const fake = createFakePi();
  monitorExtension(fake.pi as never);
  fake.lifecycle("session_start");
  return fake;
}

export async function runTool(fake: FakePi, params: Record<string, unknown>): Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }> {
  const tool = fake.tools.get("monitor");
  if (tool === undefined) throw new Error("monitor tool is not registered");
  return tool.execute("call", params, undefined, undefined, fake.ctx);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function until(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await sleep(10);
  return predicate();
}

export function injected(fake: FakePi): string[] {
  return fake.sent.filter((entry) => entry.message.customType === "monitor/output").map((entry) => entry.message.content);
}
