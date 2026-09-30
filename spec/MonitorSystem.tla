------------------------------ MODULE MonitorSystem -----------------------------
\* The monitor as a lifecycle machine coupled to a rate-limited event ledger.
\*
\* A monitor is a named shell script whose stdout lines are injected into the
\* agent conversation, tagged with the name. The loop lives in the script; the
\* wake lives here. This module owns:
\*
\*   * the lifecycle      status / gen / effect / effectFence / terminal
\*   * the event ledger   produced / queued / delivered / suppressed / digested
\*   * the rate limiter   windowAdmitted / suppressed / digestDue
\*   * the notices        alertPending / alertSent
\*
\* The rate limiter is part of the core (not a delivery detail): at most `Rate`
\* lines are admitted per window, and every non-admitted line is accounted for
\* by a digest, so nothing is silently lost. The window boundary is an
\* uninterpreted environment transition (`EndWindow`), exactly like a clock
\* tick; the proof therefore holds for every window schedule.
\*
\* There is no output payload in the model. The log path and the echoed text are
\* opaque data outside every guard; the presentation reads them but never
\* derives state from them.
\*
\* The `armed`/`running` split is load-bearing: after `Arm` a monitor is armed
\* but has no effect; `Admit` starts the effect. A process death (`PiCrash`)
\* drops every effect, leaving a `running` monitor with no effect that only
\* `Reconcile` may resolve — it can never be silently re-admitted. Re-arming is
\* refused until the ledger has settled (no queued lines, no pending digest, no
\* pending notice), so a fresh generation cannot discard accounting.
\*
\* Actions:
\*
\*   Arm(m)          declare a fresh, settled generation
\*   Admit(m)        start the process-local effect
\*   Emit(m)         the script printed a line (admitted or suppressed)
\*   Deliver(m)      hand one admitted line to the agent conversation
\*   EndWindow(m)    the rate window rolled; a digest may become due
\*   Digest(m)       account for the suppressed lines of the closed window
\*   DeliverAlert(m) send the one crash/timeout/reconcile notice
\*   Exit(m)         the script finished; silent disarm
\*   Crash(m)        the script failed; alert and disarm
\*   Timeout(m)      the optional deadline expired; alert and disarm
\*   Cancel(m)       the agent stopped it; fence the old effect
\*   EffectStale(m)  a killed generation reports back and is dropped
\*   Reconcile(m)    a restored running monitor had no process
\*   Clear(m)        forget a disarmed, quiescent monitor (reset to absent)
\*   PiCrash         every process-local effect is lost at once
\*
\* The executable mirror is `src/formal/model.ts`; `test/model.spec.ts` asserts
\* the reachable-set size equals the number TLC reports, and
\* `spec/TraceValidation.tla` replays real store traces.
\* -------------------------------------------------------------------------

EXTENDS Naturals, TLC

CONSTANTS Monitors, Rate, Cap, MaxGen, MaxEmitted

Statuses == {"absent", "armed", "running", "disarmed"}
Effects  == {"idle", "running"}
Terminals == {"none", "exited", "crashed", "timedout", "cancelled", "reconciled"}
AlertTerminals == {"crashed", "timedout", "reconciled"}

VARIABLES
    status, gen, effect, effectFence, terminal,
    produced, delivered, queued, windowAdmitted, suppressed, digested,
    digestDue, alertPending, alertSent

vars == << status, gen, effect, effectFence, terminal,
           produced, delivered, queued, windowAdmitted, suppressed, digested,
           digestDue, alertPending, alertSent >>

\* ---------------------------------------------------------------------------
\* Initial state
\* ---------------------------------------------------------------------------

Init ==
    /\ status        = [m \in Monitors |-> "absent"]
    /\ gen           = [m \in Monitors |-> 0]
    /\ effect        = [m \in Monitors |-> "idle"]
    /\ effectFence   = [m \in Monitors |-> 0]
    /\ terminal      = [m \in Monitors |-> "none"]
    /\ produced      = [m \in Monitors |-> 0]
    /\ delivered     = [m \in Monitors |-> 0]
    /\ queued        = [m \in Monitors |-> 0]
    /\ windowAdmitted = [m \in Monitors |-> 0]
    /\ suppressed    = [m \in Monitors |-> 0]
    /\ digested      = [m \in Monitors |-> 0]
    /\ digestDue     = [m \in Monitors |-> FALSE]
    /\ alertPending  = [m \in Monitors |-> FALSE]
    /\ alertSent     = [m \in Monitors |-> FALSE]

\* ---------------------------------------------------------------------------
\* Guards (one per action; shared by the action and the trace validator)
\* ---------------------------------------------------------------------------

GuardArm(m) ==
    /\ status[m] \in {"absent", "disarmed"}
    /\ gen[m] < MaxGen
    /\ (effect[m] = "idle" \/ effectFence[m] < gen[m])
    /\ queued[m] = 0
    /\ suppressed[m] = 0
    /\ ~digestDue[m]
    /\ ~alertPending[m]

GuardAdmit(m) ==
    /\ status[m] = "armed"
    /\ effect[m] = "idle"

GuardEmit(m) ==
    /\ status[m] = "running"
    /\ effect[m] = "running"
    /\ effectFence[m] = gen[m]
    /\ produced[m] < MaxEmitted
    /\ queued[m] < Cap

GuardDeliver(m) == queued[m] > 0

GuardEndWindow(m) == status[m] # "absent"

GuardDigest(m) == digestDue[m]

GuardDeliverAlert(m) == alertPending[m]

GuardExit(m) ==
    /\ status[m] = "running"
    /\ effect[m] = "running"
    /\ effectFence[m] = gen[m]

GuardCrash(m) == GuardExit(m)
GuardTimeout(m) == GuardExit(m)

GuardCancel(m) ==
    /\ status[m] \in {"armed", "running"}
    /\ gen[m] < MaxGen

GuardEffectStale(m) ==
    /\ effect[m] = "running"
    /\ effectFence[m] < gen[m]

GuardReconcile(m) ==
    /\ status[m] = "running"
    /\ effect[m] = "idle"

GuardClear(m) ==
    /\ status[m] = "disarmed"
    /\ effect[m] = "idle"
    /\ queued[m] = 0
    /\ suppressed[m] = 0
    /\ ~digestDue[m]
    /\ ~alertPending[m]

\* ---------------------------------------------------------------------------
\* Actions
\* ---------------------------------------------------------------------------

Arm(m) ==
    /\ GuardArm(m)
    /\ status'         = [status EXCEPT ![m] = "armed"]
    /\ gen'            = [gen EXCEPT ![m] = gen[m] + 1]
    /\ effect'         = [effect EXCEPT ![m] = "idle"]
    /\ effectFence'    = [effectFence EXCEPT ![m] = gen[m] + 1]
    /\ terminal'       = [terminal EXCEPT ![m] = "none"]
    /\ produced'       = [produced EXCEPT ![m] = 0]
    /\ delivered'      = [delivered EXCEPT ![m] = 0]
    /\ queued'         = [queued EXCEPT ![m] = 0]
    /\ windowAdmitted' = [windowAdmitted EXCEPT ![m] = 0]
    /\ suppressed'     = [suppressed EXCEPT ![m] = 0]
    /\ digested'       = [digested EXCEPT ![m] = 0]
    /\ digestDue'      = [digestDue EXCEPT ![m] = FALSE]
    /\ alertPending'   = [alertPending EXCEPT ![m] = FALSE]
    /\ alertSent'      = [alertSent EXCEPT ![m] = FALSE]

Admit(m) ==
    /\ GuardAdmit(m)
    /\ status'      = [status EXCEPT ![m] = "running"]
    /\ effect'      = [effect EXCEPT ![m] = "running"]
    /\ effectFence' = [effectFence EXCEPT ![m] = gen[m]]
    /\ UNCHANGED << gen, terminal, produced, delivered, queued,
                    windowAdmitted, suppressed, digested, digestDue,
                    alertPending, alertSent >>

Emit(m) ==
    /\ GuardEmit(m)
    /\ produced' = [produced EXCEPT ![m] = produced[m] + 1]
    /\ IF windowAdmitted[m] < Rate
       THEN /\ queued'         = [queued EXCEPT ![m] = queued[m] + 1]
            /\ windowAdmitted' = [windowAdmitted EXCEPT ![m] = windowAdmitted[m] + 1]
            /\ UNCHANGED suppressed
       ELSE /\ suppressed'     = [suppressed EXCEPT ![m] = suppressed[m] + 1]
            /\ UNCHANGED << queued, windowAdmitted >>
    /\ UNCHANGED << status, gen, effect, effectFence, terminal, delivered,
                    digested, digestDue, alertPending, alertSent >>

Deliver(m) ==
    /\ GuardDeliver(m)
    /\ delivered' = [delivered EXCEPT ![m] = delivered[m] + 1]
    /\ queued'    = [queued EXCEPT ![m] = queued[m] - 1]
    /\ UNCHANGED << status, gen, effect, effectFence, terminal, produced,
                    windowAdmitted, suppressed, digested, digestDue,
                    alertPending, alertSent >>

EndWindow(m) ==
    /\ GuardEndWindow(m)
    /\ windowAdmitted' = [windowAdmitted EXCEPT ![m] = 0]
    /\ digestDue'      = [digestDue EXCEPT ![m] = digestDue[m] \/ suppressed[m] > 0]
    /\ UNCHANGED << status, gen, effect, effectFence, terminal, produced,
                    delivered, queued, suppressed, digested, alertPending, alertSent >>

Digest(m) ==
    /\ GuardDigest(m)
    /\ digested'   = [digested EXCEPT ![m] = digested[m] + suppressed[m]]
    /\ suppressed' = [suppressed EXCEPT ![m] = 0]
    /\ digestDue'  = [digestDue EXCEPT ![m] = FALSE]
    /\ UNCHANGED << status, gen, effect, effectFence, terminal, produced,
                    delivered, queued, windowAdmitted, alertPending, alertSent >>

DeliverAlert(m) ==
    /\ GuardDeliverAlert(m)
    /\ alertSent'    = [alertSent EXCEPT ![m] = TRUE]
    /\ alertPending' = [alertPending EXCEPT ![m] = FALSE]
    /\ UNCHANGED << status, gen, effect, effectFence, terminal, produced,
                    delivered, queued, windowAdmitted, suppressed, digested, digestDue >>

Exit(m) ==
    /\ GuardExit(m)
    /\ status'   = [status EXCEPT ![m] = "disarmed"]
    /\ effect'   = [effect EXCEPT ![m] = "idle"]
    /\ terminal' = [terminal EXCEPT ![m] = "exited"]
    /\ UNCHANGED << gen, effectFence, produced, delivered, queued,
                    windowAdmitted, suppressed, digested, digestDue,
                    alertPending, alertSent >>

Crash(m) ==
    /\ GuardCrash(m)
    /\ status'       = [status EXCEPT ![m] = "disarmed"]
    /\ effect'       = [effect EXCEPT ![m] = "idle"]
    /\ terminal'     = [terminal EXCEPT ![m] = "crashed"]
    /\ alertPending' = [alertPending EXCEPT ![m] = TRUE]
    /\ UNCHANGED << gen, effectFence, produced, delivered, queued,
                    windowAdmitted, suppressed, digested, digestDue, alertSent >>

Timeout(m) ==
    /\ GuardTimeout(m)
    /\ status'       = [status EXCEPT ![m] = "disarmed"]
    /\ effect'       = [effect EXCEPT ![m] = "idle"]
    /\ terminal'     = [terminal EXCEPT ![m] = "timedout"]
    /\ alertPending' = [alertPending EXCEPT ![m] = TRUE]
    /\ UNCHANGED << gen, effectFence, produced, delivered, queued,
                    windowAdmitted, suppressed, digested, digestDue, alertSent >>

Cancel(m) ==
    /\ GuardCancel(m)
    /\ gen'      = [gen EXCEPT ![m] = gen[m] + 1]
    /\ status'   = [status EXCEPT ![m] = "disarmed"]
    /\ terminal' = [terminal EXCEPT ![m] = "cancelled"]
    /\ UNCHANGED << effect, effectFence, produced, delivered, queued,
                    windowAdmitted, suppressed, digested, digestDue,
                    alertPending, alertSent >>

EffectStale(m) ==
    /\ GuardEffectStale(m)
    /\ effect' = [effect EXCEPT ![m] = "idle"]
    /\ UNCHANGED << status, gen, effectFence, terminal, produced, delivered,
                    queued, windowAdmitted, suppressed, digested, digestDue,
                    alertPending, alertSent >>

Reconcile(m) ==
    /\ GuardReconcile(m)
    /\ status'       = [status EXCEPT ![m] = "disarmed"]
    /\ terminal'     = [terminal EXCEPT ![m] = "reconciled"]
    /\ alertPending' = [alertPending EXCEPT ![m] = TRUE]
    /\ UNCHANGED << gen, effect, effectFence, produced, delivered, queued,
                    windowAdmitted, suppressed, digested, digestDue, alertSent >>

\* Forget a finished monitor: every per-monitor variable returns to its initial
\* value, so the record is indistinguishable from one that was never armed. The
\* guard requires nothing to be owed (no queue, no digest, no notice) and no
\* effect left, because removal erases the generation fence that would keep a
\* stale process from writing into a re-armed generation.
Clear(m) ==
    /\ GuardClear(m)
    /\ status'         = [status EXCEPT ![m] = "absent"]
    /\ gen'            = [gen EXCEPT ![m] = 0]
    /\ effect'         = [effect EXCEPT ![m] = "idle"]
    /\ effectFence'    = [effectFence EXCEPT ![m] = 0]
    /\ terminal'       = [terminal EXCEPT ![m] = "none"]
    /\ produced'       = [produced EXCEPT ![m] = 0]
    /\ delivered'      = [delivered EXCEPT ![m] = 0]
    /\ queued'         = [queued EXCEPT ![m] = 0]
    /\ windowAdmitted' = [windowAdmitted EXCEPT ![m] = 0]
    /\ suppressed'     = [suppressed EXCEPT ![m] = 0]
    /\ digested'       = [digested EXCEPT ![m] = 0]
    /\ digestDue'      = [digestDue EXCEPT ![m] = FALSE]
    /\ alertPending'   = [alertPending EXCEPT ![m] = FALSE]
    /\ alertSent'      = [alertSent EXCEPT ![m] = FALSE]

PiCrash ==
    /\ effect' = [m \in Monitors |-> "idle"]
    /\ UNCHANGED << status, gen, effectFence, terminal, produced, delivered,
                    queued, windowAdmitted, suppressed, digested, digestDue,
                    alertPending, alertSent >>

Next ==
    \/ PiCrash
    \/ \E m \in Monitors :
         \/ Arm(m) \/ Admit(m) \/ Emit(m) \/ Deliver(m) \/ EndWindow(m)
         \/ Digest(m) \/ DeliverAlert(m) \/ Exit(m) \/ Crash(m)
         \/ Timeout(m) \/ Cancel(m) \/ EffectStale(m) \/ Reconcile(m)
         \/ Clear(m)

\* Fairness: the consumer drains, the window rolls, digests and alerts land,
\* a lost effect is reconciled, and a live effect eventually settles. The one
\* environment assumption is script termination, captured by fairness on
\* Exit/Crash/Timeout.
DeliverAny == \E m \in Monitors : Deliver(m)
EndWindowAny == \E m \in Monitors : EndWindow(m)
DigestAny == \E m \in Monitors : Digest(m)
AlertAny == \E m \in Monitors : DeliverAlert(m)
SettleAny == \E m \in Monitors : Exit(m) \/ Crash(m) \/ Timeout(m)
ReconcileAny == \E m \in Monitors : Reconcile(m)

Spec ==
    Init /\ [][Next]_vars
    /\ WF_vars(DeliverAny)
    /\ WF_vars(EndWindowAny)
    /\ WF_vars(DigestAny)
    /\ WF_vars(AlertAny)
    /\ WF_vars(SettleAny)
    /\ WF_vars(ReconcileAny)

\* ---------------------------------------------------------------------------
\* Safety invariants
\* ---------------------------------------------------------------------------

TypeOK ==
    /\ status        \in [Monitors -> Statuses]
    /\ gen           \in [Monitors -> 0..MaxGen]
    /\ effect        \in [Monitors -> Effects]
    /\ effectFence   \in [Monitors -> 0..MaxGen]
    /\ terminal      \in [Monitors -> Terminals]
    /\ produced      \in [Monitors -> 0..MaxEmitted]
    /\ delivered     \in [Monitors -> 0..MaxEmitted]
    /\ queued        \in [Monitors -> 0..Cap]
    /\ windowAdmitted \in [Monitors -> 0..Rate]
    /\ suppressed    \in [Monitors -> 0..MaxEmitted]
    /\ digested      \in [Monitors -> 0..MaxEmitted]
    /\ digestDue     \in [Monitors -> BOOLEAN]
    /\ alertPending  \in [Monitors -> BOOLEAN]
    /\ alertSent     \in [Monitors -> BOOLEAN]

EffectFenceBound ==
    \A m \in Monitors : effectFence[m] <= gen[m]

\* A running effect on a running monitor belongs to the current generation.
RunningEffectCurrent ==
    \A m \in Monitors :
        (status[m] = "running" /\ effect[m] = "running") => effectFence[m] = gen[m]

\* An armed monitor has no effect and a current fence.
ArmedIdle ==
    \A m \in Monitors : status[m] = "armed" => (effect[m] = "idle" /\ effectFence[m] = gen[m])

\* A stale effect exists only because the generation was invalidated (cancelled).
StaleOnlyAfterInvalidation ==
    \A m \in Monitors :
        (effect[m] = "running" /\ effectFence[m] < gen[m])
        => (status[m] = "disarmed" /\ terminal[m] = "cancelled")

\* A disarmed monitor whose fence is current has no live effect.
DisarmedCurrentNoEffect ==
    \A m \in Monitors :
        (status[m] = "disarmed" /\ effectFence[m] = gen[m]) => effect[m] = "idle"

\* A running monitor has no terminal outcome.
RunningHasNoTerminal ==
    \A m \in Monitors : status[m] = "running" => terminal[m] = "none"

\* Every produced line is delivered, queued, suppressed, or digested.
NoSilentLoss ==
    \A m \in Monitors :
        produced[m] = delivered[m] + queued[m] + suppressed[m] + digested[m]

RateBound ==
    \A m \in Monitors : windowAdmitted[m] <= Rate

QueueBound ==
    \A m \in Monitors : queued[m] <= Cap

DigestSound ==
    \A m \in Monitors : digestDue[m] => suppressed[m] > 0

\* A notice is sent only for a terminal that warrants one, and at most once
\* per generation (structurally: `alertSent` is boolean and only set once).
AlertSound ==
    \A m \in Monitors : alertSent[m] => terminal[m] \in AlertTerminals

AlertPendingSound ==
    \A m \in Monitors :
        alertPending[m] => (terminal[m] \in AlertTerminals /\ ~alertSent[m])

CoreInv ==
    /\ TypeOK
    /\ EffectFenceBound
    /\ RunningEffectCurrent
    /\ ArmedIdle
    /\ StaleOnlyAfterInvalidation
    /\ DisarmedCurrentNoEffect
    /\ RunningHasNoTerminal
    /\ NoSilentLoss
    /\ RateBound
    /\ QueueBound
    /\ DigestSound
    /\ AlertSound
    /\ AlertPendingSound

\* ---------------------------------------------------------------------------
\* Liveness
\* ---------------------------------------------------------------------------

\* A running effect eventually settles or is reconciled (the one environment
\* assumption is that the script terminates).
EffectsTerminate ==
    \A m \in Monitors : (status[m] = "running") ~> (status[m] = "disarmed")

\* Once disarmed, admitted lines eventually reach the conversation.
QueueDrainsAfterDisarm ==
    \A m \in Monitors :
        (status[m] = "disarmed" /\ queued[m] > 0) ~> (queued[m] = 0)

\* A due digest is eventually accounted for.
DigestsLand ==
    \A m \in Monitors : digestDue[m] ~> (digestDue[m] = FALSE)

\* A pending notice is eventually sent.
AlertsLand ==
    \A m \in Monitors : alertPending[m] ~> (alertSent[m] = TRUE)

Liveness == EffectsTerminate /\ QueueDrainsAfterDisarm /\ DigestsLand /\ AlertsLand

=============================================================================
