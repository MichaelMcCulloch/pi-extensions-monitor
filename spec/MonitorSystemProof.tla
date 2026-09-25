------------------------ MODULE MonitorSystemProof ------------------------
\* The inductive safety proof for the parameterized MonitorSystem.
\*
\* `Init => CoreInv` and every action preserves every core invariant
\* component, so `Spec => []CoreInv` holds for arbitrary constants, not only
\* the TLC fixture. The rate limiter is part of `CoreInv`: `RateBound` bounds
\* admitted lines per window and `NoSilentLoss` is the accounting conservation
\* law that makes suppression non-lossy (the digest moves suppressed lines into
\* `digested`, so the sum is invariant).
\*
\* Scope: `CoreInv` is the machine safety core. The definitional view invariants
\* (`AccountingLaw`, `NoticeComplete` in `MonitorView.tla`) and the liveness
\* properties are checked by TLC over the complete reachable state space; the
\* executable mirror is cross-checked state-for-state.
\*
\* From spec/:
\*   tlapm -I "$HOME/.local/tlapm/lib/tlapm/stdlib" MonitorSystemProof.tla
\* ---------------------------------------------------------------------

EXTENDS MonitorSystem, TLAPS

THEOREM SafetyCore ==
  ASSUME Rate \in Nat, Cap \in Nat, MaxGen \in Nat, MaxEmitted \in Nat
  PROVE Spec => []CoreInv

  <1>1. Init => CoreInv
    BY SMT DEF Init, CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
           ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
           RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
           DigestSound, AlertSound, AlertPendingSound

  <1>2. CoreInv /\ [Next]_vars => CoreInv'
    <2>1. CoreInv /\ UNCHANGED vars => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, vars

    <2>2. \A m \in Monitors: CoreInv /\ Arm(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Arm, GuardArm

    <2>3. \A m \in Monitors: CoreInv /\ Admit(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Admit, GuardAdmit

    <2>4. \A m \in Monitors: CoreInv /\ Emit(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

    <2>5. \A m \in Monitors: CoreInv /\ Deliver(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Deliver, GuardDeliver

    <2>6. \A m \in Monitors: CoreInv /\ EndWindow(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, EndWindow, GuardEndWindow

    <2>7. \A m \in Monitors: CoreInv /\ Digest(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Digest, GuardDigest

    <2>8. \A m \in Monitors: CoreInv /\ DeliverAlert(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, DeliverAlert, GuardDeliverAlert

    <2>9. \A m \in Monitors: CoreInv /\ Exit(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Exit, GuardExit

    <2>10. \A m \in Monitors: CoreInv /\ Crash(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Crash, GuardCrash

    <2>11. \A m \in Monitors: CoreInv /\ Timeout(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Timeout, GuardTimeout

    <2>12. \A m \in Monitors: CoreInv /\ Cancel(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Cancel, GuardCancel

    <2>13. \A m \in Monitors: CoreInv /\ EffectStale(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, EffectStale, GuardEffectStale

    <2>14. \A m \in Monitors: CoreInv /\ Reconcile(m) => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, Reconcile, GuardReconcile

    <2>15. CoreInv /\ PiCrash => CoreInv'
      BY SMT DEF CoreInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound,
             DigestSound, AlertSound, AlertPendingSound, PiCrash

    <2>16. QED
      BY SMT, <2>1, <2>2, <2>3, <2>4, <2>5, <2>6, <2>7, <2>8, <2>9, <2>10,
             <2>11, <2>12, <2>13, <2>14, <2>15 DEF Next, vars

  <1>3. QED
    BY <1>1, <1>2, PTL DEF Spec

=============================================================================
