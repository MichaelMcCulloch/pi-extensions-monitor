/**
 * Live steer probe: fire a monitor while the agent is mid-run (inside a long
 * bash tool call) and confirm pi steers rather than starting a second run.
 */

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const extension = resolve(root, "src/index.ts");

const PROMPT =
  "Do exactly this: (1) call the monitor tool with action=arm, name=steerprobe, " +
  'script="sleep 2; echo STEER_EVENT". (2) Then call the bash tool with command "sleep 10". ' +
  "(3) Do not cancel the bash command. (4) After bash finishes, reply with one sentence that includes the exact token STEER_EVENT only if you saw it in the conversation, otherwise reply NO_EVENT.";

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
    "--model", "deepseek-flash",
    "--extension", extension,
  ],
  { cwd: root, stdio: ["pipe", "pipe", "pipe"] },
);

const decoder = new StringDecoder("utf8");
let buffer = "";
const records: any[] = [];
const t0 = Date.now();
const stamp = (record: any): string => `+${((Date.now() - t0) / 1000).toFixed(1)}s ${record.type}`;

child.stdout.on("data", (chunk: Buffer) => {
  buffer += decoder.write(chunk);
  let index: number;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (line.trim() === "") continue;
    try {
      const record = JSON.parse(line);
      records.push(record);
      if (record.type === "turn_start" || record.type === "turn_end" || record.type === "agent_settled") {
        console.log(stamp(record));
      }
      if (record.type === "message_end" && record.message?.role === "custom") {
        console.log(`${stamp(record)} custom:${record.message.customType} ${JSON.stringify(record.message.content)}`);
      }
      if (record.type === "message_end" && record.message?.role === "assistant") {
        const content = record.message.content;
        const text = typeof content === "string" ? content : (content ?? []).map((p: any) => p?.text ?? "").join("");
        console.log(`${stamp(record)} assistant ${JSON.stringify(text.slice(0, 120))}`);
      }
    } catch {
      // ignore
    }
  }
});
child.stderr.on("data", (chunk: Buffer) => process.stderr.write(`[pi] ${chunk.toString()}`));

child.stdin.write(JSON.stringify({ id: "p1", type: "prompt", message: PROMPT }) + "\n");

await new Promise<void>((done) => {
  const started = Date.now();
  const poll = setInterval(() => {
    const sawEvent = records.some((r) => r.type === "message_end" && r.message?.role === "custom" && JSON.stringify(r.message.content).includes("STEER_EVENT"));
    const settled = records.filter((r) => r.type === "agent_settled").length >= 1;
    if ((sawEvent && settled) || Date.now() - started > 60_000) {
      clearInterval(poll);
      done();
    }
  }, 200);
});

const injected = records.find((r) => r.type === "message_end" && r.message?.role === "custom" && JSON.stringify(r.message.content).includes("STEER_EVENT"));
const bash = records.some((r) => r.type === "turn_end" && (r.toolResults ?? []).some((t: any) => t.toolName === "bash"));
const assistantTexts = records
  .filter((r) => r.type === "message_end" && r.message?.role === "assistant")
  .map((r) => {
    const c = r.message.content;
    return typeof c === "string" ? c : (c ?? []).map((p: any) => p?.text ?? "").join("");
  });

console.log("\nlive steer probe");
console.log("=================");
console.log(`monitor injection during run: ${injected ? "yes" : "no"}`);
console.log(`bash tool call used: ${bash ? "yes" : "no"}`);
console.log(`assistant messages: ${assistantTexts.length}`);
console.log(`last assistant mentions STEER_EVENT: ${assistantTexts.some((t) => t.includes("STEER_EVENT")) ? "yes" : "no"}`);
console.log(injected ? "PASS  monitor output was injected while the agent was mid-run" : "FAIL  no injection seen during the run");

child.stdin.end();
setTimeout(() => child.kill("SIGTERM"), 500).unref();
