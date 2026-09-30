# pi-monitor

A [pi](https://github.com/earendil-works/pi) extension that lets the agent arm a
**named background shell monitor**: the script prints what happens, and every
line is injected back into the conversation tagged with the monitor's name. The
script exiting disarms the monitor; a crash or timeout produces exactly one
alert. The agent can sit idle without polling — the loop lives in the script,
the wake lives in the verified core.

The whole thing is built on a **lifecycle machine coupled to a rate-limited
event ledger**, formally verified with TLA+/TLC and with an inductive TLAPS
proof for arbitrary constants. The rate limiter is part of the
verified core, not a delivery heuristic: at most `Rate` lines are admitted per
window, and every non-admitted line is accounted for by a digest, so nothing is
silently lost.

```bash
pnpm install
pnpm test              # model mirror, spec parity, engine, extension
pnpm verify:formal     # TLC model + liveness + trace validation
pnpm verify            # typecheck + tests + verify:formal + TLAPS proof
                       # (verify:proof needs tlapm 1.6+ and a Z3 on PATH)
```

Load it during development:

```bash
pi --extension ./src/index.ts
```

Then ask the agent to `monitor action=arm ...`, or drive the tool directly.

## The primitive

| Event | Injected? | Notes |
|---|---|---|
| the script prints a stdout line | **yes** | coalesced, tagged `[monitor "<name>"]`, rate-limited |
| output exceeds the rate | **yes, as a digest** | one message names the suppressed count and the log path |
| the script exits 0 | no | silent disarm |
| the script exits non-zero / signal | **yes** | one crash alert naming exit/signal and the log path |
| the timeout expires (optional) | **yes** | one timeout alert; the child is killed |
| `cancel` | no | kill the process group; bump the fence; disarm |
| `clear` | no | forget finished monitors; the log files stay on disk |
| pi exits | no | the child is killed on `session_shutdown` |
| a restored `running` monitor has no process | **yes** | one reconciliation alert; disarm |
| stderr | **no** | written to the log only |

- **Retention is the log, not the state.** The complete stdout+stderr log is at
  `/tmp/pi-monitor-<uuid>.log`; `arm` returns the path and every notice repeats
  it. `clear` forgets finished monitors from the session state but never
  touches their logs.
- **Delivery is `steer`.** `pi.sendMessage(msg, { triggerTurn: true })` steers
  while the agent is active and starts a turn while it is idle. There is no idle
  check (it would race) and no `followUp` (it would queue behind pending work).
  A monitor cannot preempt a running tool: the steer lands at the next
  assistant-turn boundary.
- **Identity is a tag.** pi has no separate model role for extension content, so
  the `monitor/output` custom message plus the in-band `[monitor "<name>"]`
  prefix is the contract; a renderer makes it visually distinct.
- **Scope is the session.** Snapshots are the `monitor/state` custom entry, so
  branching rewinds the monitors with the session. Re-arming is refused until
  the ledger has settled, so a fresh generation cannot discard accounting.

## The `monitor` tool

| Action | Effect |
|---|---|
| `arm` | declare and start a named monitor; returns the log path |
| `cancel` | kill the process group and disarm (fenced) |
| `clear` | forget finished monitors (all when `name` is omitted); a running monitor must be cancelled first |
| `list` / `status` | render the board: status, generation, queue depth, log path |

## Terminal UI

While monitors are active (armed or running), a widget above the editor shows a
header and one `📟 name` line per active monitor; it repaints on every state
transition and disappears once every monitor has finished. A finished count in
the header tells you when there is stale state to clear. Click the widget (or
run `/monitor`) to open a scrollable inspector that adds what the widget omits —
per-monitor counters, the script and cwd, and a bounded tail of the log file.
The inspector groups active monitors first and keeps finished ones under a
`finished (n)` heading until `monitor action=clear` forgets them.

## The model

`spec/MonitorSystem.tla` is the one verification subject. Per monitor it owns:

| State | Owns |
|---|---|
| `status`, `gen` | the durable lifecycle: `absent → armed → running → disarmed` |
| `effect`, `effectFence` | the process-local effect and its generation fence |
| `terminal` | `none / exited / crashed / timedout / cancelled / reconciled` |
| `produced`, `delivered`, `queued` | the event ledger (no payload) |
| `windowAdmitted`, `suppressed`, `digested`, `digestDue` | the rate limiter |
| `alertPending`, `alertSent` | the one notice |

Fifteen actions: `Arm`, `Admit`, `Emit`, `Deliver`, `EndWindow`, `Digest`,
`DeliverAlert`, `Exit`, `Crash`, `Timeout`, `Cancel`, `EffectStale`,
`Reconcile`, `Clear`, and the global `PiCrash`. The `armed`/`running` split is
load-bearing: after a process death a `running` monitor can only be
`Reconcile`d, never silently re-admitted.

`Clear` is the forgetting step: it resets a disarmed monitor to its initial
record, so the state is indistinguishable from one that was never armed. Its
guard requires nothing to be owed (no queued or suppressed output, no digest,
no notice) and no effect, because removal at the production layer erases the
generation fence that would otherwise keep a stale process from writing into a
re-armed generation. Its production payload step then drops the opaque spec, so
the board stops listing the monitor.

**Safety (`CoreInv`)**: `TypeOK`, `EffectFenceBound`, `RunningEffectCurrent`,
`ArmedIdle`, `StaleOnlyAfterInvalidation`, `DisarmedCurrentNoEffect`,
`RunningHasNoTerminal`, `NoSilentLoss` (the accounting law),
`RateBound`, `QueueBound`, `DigestSound`, `AlertSound`, `AlertPendingSound`.

**Liveness**: `EffectsTerminate`, `QueueDrainsAfterDisarm`, `DigestsLand`,
`AlertsLand`, under weak fairness on the consumer, the window, digests, alerts,
settlement, and reconciliation. The one environment assumption is that the
script terminates (or a timeout does it).

## Formal verification

```bash
pnpm verify:model     # TLC: safety + liveness over the complete state space
pnpm verify:traces    # regenerate production traces and TLC-validate them
pnpm verify:formal    # both
pnpm verify:proof     # TLAPS inductive proof (needs tlapm 1.6+)
```

### What TLC proves

Over the fixture (`Monitors = {"m1"}`, `Rate = 1`, `Cap = 2`, `MaxGen = 3`,
`MaxEmitted = 4`), TLC explores the **complete reachable state space — 2,701
distinct states**, depth 21, and checks `ViewInv` (CoreInv plus the accounting
law and notice completeness in `MonitorView.tla`) and the four liveness
properties. The window boundary is an uninterpreted environment transition, so
the check covers every window schedule.

### What TLAPS proves

`spec/MonitorSystemProof.tla` states `THEOREM SafetyCore == Spec => []CoreInv`
for **arbitrary** constants. The route is an inductive strengthening:
`InductiveInv == CoreInv /\ ArmedHasNoTerminal` is shown to hold initially
and to be preserved by every action of `Next`, and `PTL` lifts that to
`[]CoreInv`. The proof is **machine-checked**: 104 obligations, all discharged
by `tlapm` 1.6.0-pre and Z3 (`pnpm verify:proof`). One environment note is baked
into `scripts/tlapm.mjs`: TLAPS's default SMT(v3) encoding leaves some
definitional preservation goals as quantified formulas the solvers return
`unknown` on, so the driver runs `tlapm --debug oldsmt` (the v2 encoding). The
proof is checked with Z3 4.16; the Z3 4.8.9 bundled in the TLAPS 1.6.0-pre
tarball does not close every obligation, so point TLAPS's backend at a 4.16
binary (e.g. a wrapper at `<tlapm>/lib/tlapm/backends/bin/z3`).

The TLC result above covers the fixture; this proof covers every value of the
constants.

### How the proof reaches the implementation

1. **The spec is executable.** `src/formal/model.ts` transcribes
   `MonitorSystem.tla`; `test/model.spec.ts` explores it exhaustively and
   asserts the reachable set is **exactly 2,701 states** — the number TLC
   reports. Drift changes the count and fails.
2. **Production is the verified relation.** `MonitorStore`'s reducer is
   `referenceReduceMonitorState`; there is no second state. The runtime maps
   every OS outcome (`onLine`, `onExit`, `onError`, `onTimeout`) onto a model
   event, and `action=clear` is the `Clear` transition whose payload step drops
   the opaque spec.
3. **Production traces are model behaviors.** `scripts/emit-traces.ts` drives
   the real store through eight scenarios — one-shot with a digest, crash,
   timeout, cancel/re-arm fence, pi-crash/reconcile, clear/re-arm, two
   monitors, and rate suppression — and `spec/TraceValidation.tla` replays
   every step.
4. **Spec parity is locked.** `test/spec-parity.spec.ts` checks that the TLA+
   `Next` action list equals the TypeScript alphabet, that every action has a
   guard, and that every invariant name is defined in the spec.

```
MonitorSystem.tla ──TLC──▶ safety + liveness over all reachable states
      │ same relation
      ▼
src/formal/model.ts ──exhaustive──▶ 2,701 states (TLC count cross-check)
      │ used directly by
      ▼
MonitorStore ──▶ production traces ──TLC──▶ TraceValidation.tla
```

The JVM is a dev/CI tool only (`scripts/tla.mjs` finds Java 11+ and the pinned
jar); the extension runtime is pure TypeScript.

## Layout

```
src/
  formal/
    model.ts        executable mirror of spec/MonitorSystem.tla
    trace.ts        production scenario runner and TLA+ trace rendering
  engine/
    state.ts        durable state, policy, projection to the abstract state
    reducer.ts      command → events, via referenceReduceMonitorState
    projection.ts   board rendering and glyphs (pure functions)
    verify.ts       production invariant diagnostics (store refuses violations)
  extension/
    store.ts        the durable store; one state, one verified reducer
    supervisor.ts   the OS boundary: spawn, log, process-group kill
    injector.ts     the bus consumer: coalesce, rate window, digest, alerts
    runtime.ts      lifecycle mapping and the one alert
    tool.ts         the model-facing `monitor` tool
  index.ts          pi extension entry (persistence, tool, /monitor command)
spec/
  MonitorSystem.tla          the machine (recursion-free; guards, actions, CoreInv)
  MonitorView.tla            the derived accounting law and notice completeness
  MonitorSystemFixture.cfg   the TLC fixture
  MonitorSystemProof.tla     TLAPS: Spec => []CoreInv for arbitrary constants
  TraceValidation.tla        implementation trace replay
  generated/                 traces emitted from the real store
scripts/                     tla.mjs, tlapm.mjs, emit-traces.ts
test/                        model, spec-parity, engine, extension
experiments/                 the live pi RPC probes
DESIGN.md                    the prototype experiment record and design decisions
```

## Scope

Verified: the concurrent lifecycle, the generation fence, the rate-limited
ledger (no silent loss), crash/timeout/reconcile notices, and the liveness of
settlement, draining, digests, and alerts. Outside the verified core: OS process
behaviour, pipe buffering, process-group kill reliability, `sh` semantics,
filesystem logging, pi's turn scheduling and `sendCustomMessage`, and
session-log durability. The model is safe for every sequence of their outcomes.
The one user-facing limitation is that a monitor cannot interrupt a running
tool: the steer is delivered at the next turn boundary.
