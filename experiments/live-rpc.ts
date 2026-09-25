/**
 * Live end-to-end probe against the real pi binary over RPC.
 *
 * It loads the prototype, asks the model to arm a monitor, and watches for the
 * echoed lines to come back as custom messages AND start a new turn. This is
 * the one contract the harness cannot fake.
 *
 *   ../directed-acyclic-graph/node_modules/.bin/tsx experiments/live-rpc.ts
 */

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const extension = resolve(root, "src/index.ts");

const PROMPT =
  'Use the monitor tool exactly once: action "arm", name "probe", ' +
  'script "echo PROBE_ALERT; sleep 0.5; echo PROBE_DONE". ' +
  "Then reply with the single word READY. Do not call any other tool.";

const child = spawn(
  "pi",
  [
    "--mode", "rpc",
    "--no-session",
    "--approve",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-builtin-tools",
    "--model", "deepseek-flash",
    "--extension", extension,
  ],
  { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
);

const decoder = new StringDecoder("utf8");
let buffer = "";
const records: any[] = [];

child.stdout.on("data", (chunk: Buffer) => {
  buffer += decoder.write(chunk);
  let index: number;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // ignore non-JSON diagnostics on stdout
    }
  }
});
child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[pi] ${chunk.toString()}`));

function injected(): any[] {
  return records.filter(
    (record) => record.type === "message_end" && record.message?.role === "custom" && record.message?.customType === "monitor/output",
  );
}

function assistantCount(): number {
  return records.filter((record) => record.type === "message_end" && record.message?.role === "assistant").length;
}

function textOf(record: any): string {
  const content = record.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part: any) => part?.text ?? "").join("");
  return "";
}

const started = Date.now();
const deadline = started + 90_000;
let injectedCountAtFirstAssistant = -1;

child.stdin.write(JSON.stringify({ id: "p1", type: "prompt", message: PROMPT }) + "\n");

await new Promise<void>((resolvePromise) => {
  const poll = setInterval(() => {
    // Record how many injections preceded the first assistant message.
    if (injectedCountAtFirstAssistant < 0 && injected().length > 0 && assistantCount() > 0) {
      injectedCountAtFirstAssistant = injected().length;
    }
    const done = injected().some((record) => textOf(record).includes("PROBE_DONE"));
    const sawTurnAfterInjection = injected().length > 0 && assistantCount() >= 2;
    if ((done && sawTurnAfterInjection) || Date.now() > deadline) {
      clearInterval(poll);
      resolvePromise();
    }
  }, 200);
});

const custom = injected();
const texts = custom.map((record) => textOf(record));
const sawAlert = texts.some((text) => text.includes("PROBE_ALERT"));
const sawDone = texts.some((text) => text.includes("PROBE_DONE"));
const settled = records.filter((record) => record.type === "agent_settled").length;
const toolCalls = records.filter((record) => record.type === "turn_end").flatMap((record) => record.toolResults ?? []);

console.log("\nlive RPC probe");
console.log("==============");
console.log(`records=${records.length}`);
console.log(`monitor custom messages=${custom.length}`);
console.log(`  texts=${JSON.stringify(texts)}`);
console.log(`agent_settled=${settled}`);
console.log(`toolResults=${toolCalls.length}`);
console.log(`assistant messages=${assistantCount()}`);
console.log("");
console.log(sawAlert && sawDone ? "PASS  monitor output reached the real pi session as custom messages" : "FAIL  monitor output did not reach the session");
console.log(assistantCount() >= 2 ? "PASS  injected output started a new turn" : "WARN  no second assistant turn observed");

child.stdin.end();
setTimeout(() => child.kill("SIGTERM"), 500).unref();
