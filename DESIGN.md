# Design and experiment record (prototype)

**Status: prototyped and measured. Not yet proven.** This is the document to
read before writing `MonitorSystem.tla`. It records what was built, what the
experiments found, and the machine those findings imply.

The goal is an **asynchronous, named, streaming monitor**: the agent arms a
shell script and ends its turn; anything the script prints to stdout is injected
back into the conversation tagged with the monitor's name; the script exiting
disarms the monitor; a crash or timeout produces exactly one alert. The agent
sits idle without polling — the loop lives in the script, the wake lives in the
extension.

---

## 1. Behaviour contract (as built and tested)

| Event | Injected? | Notes |
|---|---|---|
| script prints a stdout line | **yes** | batched; tagged `[monitor "<name>"]`; rate-limited |
| output exceeds the rate | **yes, as a digest** | one message names the suppressed count and the log path |
| script exits 0 | no | silent disarm; `terminal = exited` |
| script exits non-zero / signal | **yes** | one crash notice naming exit/signal and the log path |
| timeout expires (optional) | **yes** | one timeout notice; child killed |
| `cancel` | no | kill the process group; bump the fence; disarm |
| pi exits | no | child killed on `session_shutdown` |
| restored `running` with no process | **yes** | one reconciliation notice; disarm |
| stderr | **no** | written to the log only |

- **Retention**: none in state. The complete stdout+stderr log lives at
  `/tmp/pi-monitor-<uuid>.log`; the **`arm` tool result returns the path**, and
  every crash/timeout/digest notice repeats it.
- **Tool**: `monitor` with actions `arm`, `cancel`, `list`, `status`;
  `executionMode: "sequential"` (single-writer supervisor). No `tail` — the
  agent reads the log with its normal tools.
- **Scope**: session-scoped; snapshots are the `monitor/state` custom entry;
  reconstructed from the branch on `session_start` / `session_tree`.
- **Identity**: `monitor/output` custom message, never a user message. The
  model-visible marker is the in-band `[monitor "<name>"]` prefix, because pi
  converts custom content to a user-role message and offers no separate role.

---

## 2. Architecture

```
  monitor tool ──arm/cancel──▶ MonitorSupervisor ──spawn──▶ sh -c <script>
        │                            │  stdout lines, exit, timeout
        │                            │  each line appended to <logPath>
        │                            ▼
        │                   pi.events "monitor:event"
        │                            │
        │              ┌─────────────┴─────────────┐
        │              ▼                           ▼
        │      MonitorInjector              (any other extension)
        │      coalesce + rate limit        observes for free
        │              │
        │              ▼
        │      pi.sendMessage(..., { triggerTurn: true })
        │
        └── MonitorSnapshot ──▶ pi.appendEntry("monitor/state", …)
```

The **event bus is the seam**: the supervisor never calls the injector; it
emits, and the injector subscribes. That also means a future extension (a
renderer, a board sink, a DAG wake) can observe monitor events without touching
this extension.

Files: `src/supervisor.ts` (source), `src/injector.ts` (sink/policy),
`src/tool.ts`, `src/projection.ts`, `src/index.ts` (wiring), `src/types.ts`;
experiments in `experiments/`.

---

## 3. What the experiments found

Harness (`experiments/run.ts`, 18 hypotheses, all held) and live pi over RPC
(`experiments/live-rpc.ts`, `experiments/live-steer.ts`).

### 3.1 Findings that changed the design

- **F1 — one call delivers in both states.** `pi.sendMessage(msg, {triggerTurn:
  true})` runs the turn when idle and *steers* while the agent is active
  (`agent-session.js`: `isStreaming && triggerTurn !== false` → `agent.steer`).
  Idle detection in the extension is therefore not just unnecessary, it is a
  **race**. The `isIdle()` plumbing was deleted. Never `followUp`: it queues
  behind pending work, which defeats the wake.
- **F2 — the agent run includes tool execution.** `isStreaming` is the whole run
  (`_isAgentRunActive`), not just token streaming. A monitor firing during a
  long tool call also steers; there is no concurrent-run hazard.
- **F3 — steer lands at the next turn boundary, not immediately.** Live probe:
  a monitor firing at ~4 s during a 10 s `bash sleep` surfaced at +13.4 s, right
  at the next `turn_start`, and the model saw it. A monitor **cannot preempt a
  running tool**; it is delivered after the current assistant turn. This is the
  accepted meaning of "steer only" and must be stated, not wished away.
- **F4 — coalescing is mandatory; chunking preserves.** 500 echoed lines:
  - immediate: **500 messages**;
  - coalesce with a drop cap: data lost;
  - coalesce + `maxBatch`, no drop: **10 messages, all 500 events delivered**.
  Default `flushMs = 25`, `maxBatch = 50`.
- **F5 — a rate limiter, not a total budget.** At most `ratePerWindow` lines are
  admitted per `windowMs` (default 60 / 1000 ms). Excess is **suppressed, never
  silently dropped**: when the window ends (or the monitor settles) one digest
  message reports how many were suppressed and where the log is. Verified:
  200 lines with a 20-line window → 180 suppressed, 1 digest, **200 lines in the
  log**. This is the flood valve; it cannot starve a long-lived watcher the way a
  lifetime cap would.
- **F6 — line framing.** Newline-delimited; the partial final line is delivered
  (verified). A line longer than 8 KiB is truncated **for the injected text
  only** with a `…[+N chars; log: <path>]` marker (200 KB line → 8 288 injected
  chars); the log keeps it whole.
- **F7 — identity is a tag, by necessity.** pi has no separate model role for
  extension content, so `monitor/output` + the in-band prefix is the contract.
- **F8 — the log is the retention.** `arm` returns `/tmp/pi-monitor-<uuid>.log`;
  stdout lines are appended verbatim, stderr as `stderr: <line>`; the path is
  repeated in every notice. Verified present and complete after a crash.

### 3.2 Findings that confirm the fences

- **F9 — a crash emits exactly one notice**, carrying exit code or signal and
  the log path. Signals are reported (`killed by SIGTERM`).
- **F10 — timeout is optional and effective**: one notice, child killed.
- **F11 — the generation fence works**: cancel + re-arm the same name leaked no
  old line and produced no false crash from the kill.
- **F12 — shutdown kills the process group**: a child could not write its marker
  after `session_shutdown`.
- **F13 — reload reconciliation works**: a restored `running` record with no
  process produced one "was running when pi exited" notice and disarmed.
- **F14 — per-monitor FIFO holds** under concurrent monitors (`a1..a4`,
  `b1..b4`), even though inter-monitor order is arbitrary.
- **F15 — a settle boundary flushes a held batch.**

---

## 4. The machine the findings imply

Deliberately smaller than the DAG: no worktrees, no merge, no command/effect
duality beyond one generation fence. Per monitor `m`:

| Var | Owns |
|---|---|
| `status[m]` | `absent → armed → running → disarmed`; `disarmed` sticky until re-arm |
| `gen[m]` | monotone fence; bumped by `arm`, `cancel`, and every settle |
| `effect[m]` | process-local `idle`/`running`; a restored `running` status with `effect = idle` **is** a crash |
| `terminal[m]` | `none / exited / crashed / timedout / cancelled / reconciled` |
| `emitted[m]`, `delivered[m]` | emitted = delivered + pending; the queue carries no payload in the model |
| `log[m]` | the opaque log path (payload; never a guard) |
| `window[m]`, `admitted[m]`, `suppressed[m]` | the rate limiter |

**Actions**: `arm`, `admit`, `emit`, `deliver`, `end-window`, `digest`, `exit`,
`crash`, `timeout`, `cancel`, `effect-stale`, `pi-crash`, `reconcile`.

**Invariants**
- `EffectLiveImpliesRunning` — a live child only on a running, current-gen monitor.
- `StaleOnlyAfterInvalidation` — an old-generation effect exists only after cancel/re-arm.
- `DisarmedNoEffect` — disarm implies the process slot is idle.
- `Fifo` / `NoLostEmitted` — a per-monitor queue, no loss inside the window.
- `RateBound` — at most `Rate` lines admitted per window.
- `NoSilentLoss` — every emitted line is delivered or covered by a digest.
- `DigestOnce` — at most one digest per window, naming the suppressed count.
- `CrashNoticeOnce` — a crash/timeout emits exactly one notice, after ordinary output.
- `Tagged` — the name is structural on every queued event.
- `TerminalStable` — `disarmed` does not change without an arm or reconcile.

**Liveness** (given the OS terminates the child, or the deadline does):
`running ⇒ ◇ disarmed` (WF on `exit`/`crash`); `deliver` drains the queue
(SF on `deliver`); `suppressed ⇒ ◇ digest` (WF on `end-window`, SF on `deliver`).

**Fixture**: two monitors, `Cap = 2`, `MaxGen = 2`, `Rate = 1`, a two-symbol
line alphabet — small enough for exhaustive TLC and a TLAPS core proof. The
window is an uninterpreted environment transition, exactly like a clock tick.

**Presentation**: `glyph`, `renderBoard`, and the injector's `render` are total
functions of the records and the opaque payload. Batching and the window are
delivery projections; the FIFO and the fence are the theorem.

---

## 5. Decisions (locked)

Rate limiter, not a lifetime budget (F5). Silent clean exit (F4 of the early
round). No in-state retention; the log file is the only retention, and `arm`
returns its path (F8). Streamed stdout only; stderr to the log (F9). One
`{triggerTurn:true}` delivery (F1). Steer-at-boundary semantics documented (F3).
Line cap for context only (F6). Tag identity (F7). Generation fence (F11).
Shutdown group-kill (F12). Reload reconciliation (F13). Per-monitor FIFO (F14).
Settle flush (F15).

---

## 6. Not to be proven (the residual)

As in the siblings: OS process behaviour, pipe buffering, process-group kill
reliability, `sh` semantics, filesystem logging, pi's turn scheduling and
`sendCustomMessage` implementation, and JSON/session durability. The model is
safe **for every sequence of their outcomes**. The genuine user-facing
limitation to state in the README is F3: a monitor cannot interrupt a running
tool.

---

## 7. Built

The behaviour was pinned, then built and verified. The verified core is
`spec/MonitorSystem.tla` + `MonitorView.tla` (TLC: 2,701 distinct states, safety
and liveness), mirrored by `src/formal/model.ts` (exhaustive cross-check), with
`spec/MonitorSystemProof.tla` for TLAPS and `spec/TraceValidation.tla` replaying
seven production traces. The rate limiter is in the core, with the window an
uninterpreted environment transition.

Two changes the prototype had not settled, both found while writing the machine:

- **The `armed`/`running` split.** A single `running` status let `PiCrash`
  re-enable `Admit` forever; TLC's liveness checker produced exactly that lasso.
  Splitting `armed` (intent, no effect) from `running` (live effect) means a
  process death can only be `Reconcile`d.
- **Re-arm requires a settled ledger.** `Arm` refuses while lines are queued,
  a digest is due, or a notice is pending, so a fresh generation cannot discard
  accounting; TLC then proves draining, digests, and alerts land.

The production code is `src/extension/{store,supervisor,injector,runtime,tool}.ts`
over `src/engine/*`; the OS boundary is `supervisor.ts`, and every outcome it
can produce is mapped to a model event. `DESIGN.md` section 3 remains the record
of the experiments that chose the behaviour.
