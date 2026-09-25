/**
 * Emit `spec/generated/TracesData.tla` from the production store.
 *
 * Run through `scripts/tla.mjs traces`; TLC then replays every step against
 * `spec/MonitorSystem.tla` with `spec/TraceValidation.tla`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildTraces, renderTracesModule } from "../src/formal/trace.ts";

const traces = buildTraces();
const target = fileURLToPath(new URL("../spec/generated/TracesData.tla", import.meta.url));
mkdirSync(fileURLToPath(new URL("../spec/generated", import.meta.url)), { recursive: true });
writeFileSync(target, renderTracesModule(traces.map((entry) => entry.trace)), "utf8");
process.stdout.write(`emitted ${traces.length} traces (${traces.map((entry) => entry.name).join(", ")}) -> ${target}\n`);
