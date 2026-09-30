#!/usr/bin/env node
/**
 * Inductive-proof driver (TLAPS / tlapm).
 *
 *   node scripts/tlapm.mjs        check spec/MonitorSystemProof.tla
 *
 * Proves `Spec => []CoreInv` for EVERY value of the constants -- the
 * parameterized MonitorSystem, not the TLC fixture. `spec/MonitorSystemProof.tla`
 * establishes `Init => InductiveInv` and that each action preserves
 * `InductiveInv == CoreInv /\ ArmedHasNoTerminal`; `PTL` turns that into
 * `[]CoreInv`.
 *
 * The driver passes `--debug oldsmt`: TLAPS's default SMT(v3) encoding leaves
 * some definitional preservation goals as quantified formulas the solvers
 * return `unknown` on, while the v2 encoding discharges them. The proof is
 * checked with Z3 4.16; the 4.8.9 bundled in the TLAPS 1.6.0-pre tarball does
 * not close every obligation.
 *
 * tlapm is not installed by default. TLAPS needs a Z3 on `PATH`; install
 * tlapm 1.6+ from https://github.com/tlaplus/tlapm/releases, or set TLAPM and
 * TLAPM_LIBRARY.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const specDir = resolve(root, "spec");
const PROOF = "MonitorSystemProof.tla";

function findTlapm() {
  const candidates = [
    process.env.TLAPM,
    resolve(process.env.HOME ?? "", ".local/tlapm/bin/tlapm"),
    "/usr/local/bin/tlapm",
    "/usr/bin/tlapm",
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);
  for (const candidate of candidates) {
    if (candidate === "tlapm" || existsSync(candidate)) return candidate;
  }
  return "tlapm";
}

function findStdlib(tlapm) {
  if (process.env.TLAPM_LIBRARY) return process.env.TLAPM_LIBRARY;
  const candidates = [
    resolve(dirname(tlapm), "..", "lib/tlapm/stdlib"),
    resolve(process.env.HOME ?? "", ".local/tlapm/lib/tlapm/stdlib"),
    "/usr/local/lib/tlapm/stdlib",
    "/usr/lib/tlapm/stdlib",
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "TLAPS.tla"))) return candidate;
  }
  return undefined;
}

function main() {
  const tlapm = findTlapm();
  const stdlib = findStdlib(tlapm);
  const args = [];
  if (stdlib) args.push("-I", stdlib);
  // The proof's definitional preservation obligations are discharged by the
  // v2 SMT encoding; the default v3 encoding leaves quantified function/UPDATE
  // goals that the bundled solvers return `unknown` on.
  args.push("--debug", "oldsmt");
  args.push(PROOF);

  process.stdout.write(`\n$ (cd spec && ${tlapm} ${args.join(" ")})\n`);
  const result = spawnSync(tlapm, args, {
    cwd: specDir,
    stdio: "inherit",
    env: { ...process.env, PATH: `${dirname(tlapm)}${delimiter}${process.env.PATH ?? ""}` },
  });
  if (result.error) {
    process.stderr.write(
      `\nTLAPS not available (${result.error.message}).\n` +
        "Install tlapm 1.6+ (https://github.com/tlaplus/tlapm/releases) and a Z3 on PATH,\n" +
        "or set TLAPM and TLAPM_LIBRARY. TLC already checks the fixture (`node scripts/tla.mjs model`).\n",
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`\ninductive proof failed (tlapm exit ${result.status ?? "signal"})\n`);
    process.exit(1);
  }
  process.stdout.write("inductive proof passed: Spec => []CoreInv for all constants\n");
}

main();
