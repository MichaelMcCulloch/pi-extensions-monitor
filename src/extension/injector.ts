/**
 * The injector: the delivery half, and the only writer of the ledger actions
 * (`emit`, `deliver`, `end-window`, `digest`).
 *
 * It subscribes to the shared event bus: the runtime emits one `monitor:line`
 * per stdout line, and the injector turns those into coalesced messages. It
 * keeps the *text* in a process-local buffer that runs parallel to the model's
 * `queued` counter, so the verified state stays payload-free while delivery
 * still carries the echoed line.
 *
 * One `{triggerTurn:true}` call is correct in both states: `sendCustomMessage`
 * steers while the agent is active and starts a turn while it is idle. There is
 * no idle check and no `followUp`.
 *
 * The rate limiter lives in the verified model; the injector only executes its
 * decisions. When the window closes with suppressed lines, the injector sends
 * the one digest the model requires and then accounts for it.
 */

import type { MonitorStore } from "./store.ts";

/** The bus channel the runtime emits stdout lines on. */
export const MONITOR_LINE_CHANNEL = "monitor:line";

export interface LineEvent {
  readonly name: string;
  readonly text: string;
}

/** A message handed to pi. Mirrors the smallest part of `pi.sendMessage`. */
export interface OutgoingMessage {
  readonly message: {
    readonly customType: string;
    readonly content: string;
    readonly display: boolean;
    readonly details: unknown;
  };
  readonly options: { readonly triggerTurn?: boolean; readonly deliverAs?: "steer" | "followUp" | "nextTurn" };
}

export interface InjectorOptions {
  readonly events: { on(channel: string, handler: (data: unknown) => void): () => void };
  readonly store: MonitorStore;
  readonly send: (outgoing: OutgoingMessage) => void;
  readonly backpressure: { pause(name: string): void; resume(name: string): void };
}

/** The model-visible prefix. One stable marker, so the model can tell it apart. */
export function monitorPrefix(name: string): string {
  return `[monitor "${name}"]`;
}

/** The text of one delivered batch or notice. */
export function renderMonitorMessage(name: string, kind: "output" | "digest" | "alert", text: string, lines: number): string {
  const prefix = monitorPrefix(name);
  if (kind === "output" && lines > 1) return `${prefix} ${lines} lines\n${text}`;
  return `${prefix} ${text}`;
}

export class MonitorInjector {
  readonly #options: InjectorOptions;
  readonly #pending = new Map<string, string[]>();
  readonly #flushTimers = new Map<string, NodeJS.Timeout>();
  readonly #windowTimers = new Map<string, NodeJS.Timeout>();
  #unsubscribe: (() => void) | null = null;

  public constructor(options: InjectorOptions) {
    this.#options = options;
  }

  public start(): void {
    this.#unsubscribe = this.#options.events.on(MONITOR_LINE_CHANNEL, (data) => this.#onLine(data as LineEvent));
  }

  public stop(): void {
    for (const timer of this.#flushTimers.values()) clearTimeout(timer);
    for (const timer of this.#windowTimers.values()) clearTimeout(timer);
    this.#flushTimers.clear();
    this.#windowTimers.clear();
    this.#pending.clear();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  /** Force pending batches and digests out (called at settle and on disarm). */
  public flushAll(): void {
    for (const name of [...this.#pending.keys()]) this.#flush(name);
    for (const name of [...this.#windowTimers.keys()]) this.#endWindow(name);
  }

  /** Drop all delivery state for a monitor (on cancel / shutdown). */
  public forget(name: string): void {
    const flush = this.#flushTimers.get(name);
    if (flush !== undefined) clearTimeout(flush);
    const window = this.#windowTimers.get(name);
    if (window !== undefined) clearTimeout(window);
    this.#flushTimers.delete(name);
    this.#windowTimers.delete(name);
    this.#pending.delete(name);
  }

  #onLine(event: LineEvent): void {
    // A line from a dead or already-forgotten child must not reach the ledger:
    // after `clear` the monitor has no fence left to attribute it to.
    const status = this.#options.store.state.status[event.name];
    if (status !== "armed" && status !== "running") return;
    const result = this.#options.store.emit(event.name);
    if (result.admitted === true) {
      const pending = this.#pending.get(event.name) ?? [];
      pending.push(event.text);
      this.#pending.set(event.name, pending);
      this.#scheduleFlush(event.name);
    }
    // A suppressed line is deliberately not buffered: the window digest accounts for it.
    this.#ensureWindow(event.name);
    const queued = this.#options.store.state.queued[event.name] ?? 0;
    if (queued >= this.#options.store.policy.cap) this.#options.backpressure.pause(event.name);
  }

  #scheduleFlush(name: string): void {
    if (this.#flushTimers.has(name)) return;
    this.#flushTimers.set(
      name,
      setTimeout(() => this.#flush(name), this.#options.store.policy.flushMs),
    );
  }

  #flush(name: string): void {
    const timer = this.#flushTimers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.#flushTimers.delete(name);
    const policy = this.#options.store.policy;
    const batch: string[] = [];
    while ((this.#options.store.state.queued[name] ?? 0) > 0 && batch.length < policy.maxBatch) {
      const result = this.#options.store.deliver(name);
      if (result.events.length === 0) break;
      const text = this.#pending.get(name)?.shift();
      if (text !== undefined) batch.push(text);
    }
    if (batch.length > 0) {
      this.#options.send({
        message: {
          customType: "monitor/output",
          content: renderMonitorMessage(name, "output", batch.join("\n"), batch.length),
          display: true,
          details: { name, kind: "output", lines: batch.length },
        },
        options: { triggerTurn: true },
      });
    }
    const remaining = this.#options.store.state.queued[name] ?? 0;
    if (remaining > 0) {
      this.#flushTimers.set(name, setTimeout(() => this.#flush(name), 0));
    } else {
      this.#options.backpressure.resume(name);
    }
  }

  #ensureWindow(name: string): void {
    if (this.#windowTimers.has(name)) return;
    this.#windowTimers.set(
      name,
      setTimeout(() => this.#endWindow(name), this.#options.store.policy.windowMs),
    );
  }

  #endWindow(name: string): void {
    const timer = this.#windowTimers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.#windowTimers.delete(name);
    if (this.#options.store.state.status[name] === undefined) return;
    this.#options.store.endWindow(name);
    if (this.#options.store.state.digestDue[name] !== true) return;
    const { digested } = this.#options.store.digest(name);
    if (digested <= 0) return;
    const logPath = this.#options.store.state.specs[name]?.logPath ?? "(unknown)";
    this.#options.send({
      message: {
        customType: "monitor/output",
        content: renderMonitorMessage(name, "digest", `${digested} line(s) suppressed by the rate limit; full log: ${logPath}`, 1),
        display: true,
        details: { name, kind: "digest", suppressed: digested, logPath },
      },
      options: { triggerTurn: true },
    });
  }
}
