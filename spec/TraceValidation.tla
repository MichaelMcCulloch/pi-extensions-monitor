------------------------- MODULE TraceValidation --------------------------
\* Replay implementation traces against the verified monitor machine.
\* `spec/generated/TracesData.tla` defines `Traces`; each trace step names an
\* action and the state the model should be in afterwards. A disabled action
\* sets `error`, rejected by `TraceInv` with a counterexample naming the step.
\* -------------------------------------------------------------------------

EXTENDS MonitorSystem, TracesData, Naturals, Sequences, FiniteSets, TLC

VARIABLES traceNo, traceIndex, error

Trace == Traces[traceNo]

state ==
    [ status |-> status, gen |-> gen, effect |-> effect,
      effectFence |-> effectFence, terminal |-> terminal,
      produced |-> produced, delivered |-> delivered, queued |-> queued,
      windowAdmitted |-> windowAdmitted, suppressed |-> suppressed,
      digested |-> digested, digestDue |-> digestDue,
      alertPending |-> alertPending, alertSent |-> alertSent ]

machineVars == << status, gen, effect, effectFence, terminal,
                 produced, delivered, queued, windowAdmitted, suppressed,
                 digested, digestDue, alertPending, alertSent >>

ActionOf(ev) ==
    \/ (ev.type = "arm"          /\ Arm(ev.monitor))
    \/ (ev.type = "admit"        /\ Admit(ev.monitor))
    \/ (ev.type = "emit"         /\ Emit(ev.monitor))
    \/ (ev.type = "deliver"      /\ Deliver(ev.monitor))
    \/ (ev.type = "end-window"   /\ EndWindow(ev.monitor))
    \/ (ev.type = "digest"       /\ Digest(ev.monitor))
    \/ (ev.type = "deliver-alert" /\ DeliverAlert(ev.monitor))
    \/ (ev.type = "exit"         /\ Exit(ev.monitor))
    \/ (ev.type = "crash"        /\ Crash(ev.monitor))
    \/ (ev.type = "timeout"      /\ Timeout(ev.monitor))
    \/ (ev.type = "cancel"       /\ Cancel(ev.monitor))
    \/ (ev.type = "effect-stale" /\ EffectStale(ev.monitor))
    \/ (ev.type = "reconcile"    /\ Reconcile(ev.monitor))
    \/ (ev.type = "pi-crash"     /\ PiCrash)

GuardOf(ev) ==
    \/ (ev.type = "arm"          /\ GuardArm(ev.monitor))
    \/ (ev.type = "admit"        /\ GuardAdmit(ev.monitor))
    \/ (ev.type = "emit"         /\ GuardEmit(ev.monitor))
    \/ (ev.type = "deliver"      /\ GuardDeliver(ev.monitor))
    \/ (ev.type = "end-window"   /\ GuardEndWindow(ev.monitor))
    \/ (ev.type = "digest"       /\ GuardDigest(ev.monitor))
    \/ (ev.type = "deliver-alert" /\ GuardDeliverAlert(ev.monitor))
    \/ (ev.type = "exit"         /\ GuardExit(ev.monitor))
    \/ (ev.type = "crash"        /\ GuardCrash(ev.monitor))
    \/ (ev.type = "timeout"      /\ GuardTimeout(ev.monitor))
    \/ (ev.type = "cancel"       /\ GuardCancel(ev.monitor))
    \/ (ev.type = "effect-stale" /\ GuardEffectStale(ev.monitor))
    \/ (ev.type = "reconcile"    /\ GuardReconcile(ev.monitor))
    \/ (ev.type = "pi-crash"     /\ TRUE)

AssignState(s) ==
    /\ status = s.status
    /\ gen = s.gen
    /\ effect = s.effect
    /\ effectFence = s.effectFence
    /\ terminal = s.terminal
    /\ produced = s.produced
    /\ delivered = s.delivered
    /\ queued = s.queued
    /\ windowAdmitted = s.windowAdmitted
    /\ suppressed = s.suppressed
    /\ digested = s.digested
    /\ digestDue = s.digestDue
    /\ alertPending = s.alertPending
    /\ alertSent = s.alertSent

TraceInit ==
    /\ traceNo \in 1..Len(Traces)
    /\ traceIndex = 1
    /\ error = FALSE
    /\ AssignState(Trace[1].state)

TraceStep ==
    LET ev == Trace[traceIndex + 1].event IN
      \/ (GuardOf(ev) /\ ActionOf(ev) /\ UNCHANGED error)
      \/ (~GuardOf(ev) /\ UNCHANGED machineVars /\ error' = TRUE)

TraceNext ==
    \/ /\ traceIndex < Len(Trace)
       /\ TraceStep
       /\ traceIndex' = traceIndex + 1
       /\ UNCHANGED traceNo
    \/ /\ traceIndex = Len(Trace)
       /\ UNCHANGED << machineVars, traceNo, traceIndex, error >>

TraceSpec ==
    TraceInit /\ [][TraceNext]_<<machineVars, traceNo, traceIndex, error>>

TraceInv ==
    /\ error = FALSE
    /\ (traceIndex > 0 => state = Trace[traceIndex].state)

=============================================================================
