------------------------ MODULE MonitorSystemProof ------------------------
\* The inductive safety proof for the parameterized MonitorSystem.
\*
\* `Init => InductiveInv` and every action preserves `InductiveInv`, which
\* includes `CoreInv`, so `Spec => []CoreInv` holds for arbitrary constants,
\* not only the TLC fixture. The rate limiter is part of `CoreInv`: `RateBound`
\* bounds admitted lines per window and `NoSilentLoss` is the conservation
\* law that makes suppression non-lossy (the digest moves suppressed lines into
\* `digested`, so the sum is invariant).
\*
\* Scope: `CoreInv` is the machine safety core. The definitional view invariants
\* (`AccountingLaw`, `NoticeComplete` in `MonitorView.tla`) and the liveness
\* properties are checked by TLC over the complete reachable state space; the
\* executable mirror is cross-checked state-for-state.
\*
\* From spec/:
\*   tlapm -I "$HOME/.local/tlapm/lib/tlapm/stdlib" --debug oldsmt MonitorSystemProof.tla
\* ---------------------------------------------------------------------

EXTENDS MonitorSystem, TLAPS

\* Admit needs this fact to establish RunningHasNoTerminal; Cancel needs it
\* to rule out an outstanding or sent alert while armed. It is established by
\* Init and preserved by every action, rather than assumed of the machine.
ArmedHasNoTerminal ==
  \A m \in Monitors: status[m] = "armed" => terminal[m] = "none"

InductiveInv == CoreInv /\ ArmedHasNoTerminal

THEOREM SafetyCore ==
  ASSUME Rate \in Nat, Cap \in Nat, MaxGen \in Nat, MaxEmitted \in Nat
  PROVE SafetySpec => []CoreInv

  <1>1. Init => InductiveInv
    BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals, AlertTerminals,
           Init, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent, ArmedIdle,
           StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect, RunningHasNoTerminal,
           NoSilentLoss, RateBound, QueueBound, DigestSound, AlertSound, AlertPendingSound

  <1>2. InductiveInv /\ [Next]_vars => InductiveInv'
    <2>1. InductiveInv /\ UNCHANGED vars => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, vars

    <2>2. \A m \in Monitors: InductiveInv /\ Arm(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Arm, GuardArm

    <2>3. \A m \in Monitors: InductiveInv /\ Admit(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Admit, GuardAdmit

    \* Split Emit by invariant, and typing by the admitted/suppressed branch,
    \* to keep the v2 SMT obligations tractable with Z3 4.16.
    <2>4. \A m \in Monitors: InductiveInv /\ Emit(m) => InductiveInv'
      <3>1. \A m \in Monitors: InductiveInv /\ Emit(m) => TypeOK'
        <4>1. \A m \in Monitors:
          InductiveInv /\ Emit(m) /\ windowAdmitted[m] < Rate => TypeOK'
          BY SMT DEF InductiveInv, CoreInv, Emit, GuardEmit, TypeOK, Statuses, Effects,
                 Terminals, NoSilentLoss
        <4>2. \A m \in Monitors:
          InductiveInv /\ Emit(m) /\ ~(windowAdmitted[m] < Rate) => TypeOK'
          BY SMT DEF InductiveInv, CoreInv, Emit, GuardEmit, TypeOK, Statuses, Effects,
                 Terminals, NoSilentLoss
        <4>3. QED BY SMT, <4>1, <4>2

      <3>2. \A m \in Monitors: InductiveInv /\ Emit(m) => EffectFenceBound'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>3. \A m \in Monitors: InductiveInv /\ Emit(m) => RunningEffectCurrent'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>4. \A m \in Monitors: InductiveInv /\ Emit(m) => ArmedIdle'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>5. \A m \in Monitors: InductiveInv /\ Emit(m) => StaleOnlyAfterInvalidation'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>6. \A m \in Monitors: InductiveInv /\ Emit(m) => DisarmedCurrentNoEffect'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>7. \A m \in Monitors: InductiveInv /\ Emit(m) => RunningHasNoTerminal'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>8. \A m \in Monitors: InductiveInv /\ Emit(m) => NoSilentLoss'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>9. \A m \in Monitors: InductiveInv /\ Emit(m) => RateBound'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>10. \A m \in Monitors: InductiveInv /\ Emit(m) => QueueBound'
        BY SMT DEF InductiveInv, CoreInv, Emit, GuardEmit, TypeOK, QueueBound

      <3>11. \A m \in Monitors: InductiveInv /\ Emit(m) => DigestSound'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>12. \A m \in Monitors: InductiveInv /\ Emit(m) => AlertSound'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>13. \A m \in Monitors: InductiveInv /\ Emit(m) => AlertPendingSound'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>14. \A m \in Monitors: InductiveInv /\ Emit(m) => ArmedHasNoTerminal'
        BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
               AlertTerminals, InductiveInv, TypeOK, EffectFenceBound,
               RunningEffectCurrent, ArmedIdle, StaleOnlyAfterInvalidation,
               DisarmedCurrentNoEffect, RunningHasNoTerminal, NoSilentLoss, RateBound,
               QueueBound, DigestSound, AlertSound, AlertPendingSound, Emit, GuardEmit

      <3>15. QED
        BY SMT, <3>1, <3>2, <3>3, <3>4, <3>5, <3>6, <3>7, <3>8, <3>9, <3>10, <3>11, <3>12,
               <3>13, <3>14 DEF InductiveInv, CoreInv, ArmedHasNoTerminal

    <2>5. \A m \in Monitors: InductiveInv /\ Deliver(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Deliver, GuardDeliver

    <2>6. \A m \in Monitors: InductiveInv /\ EndWindow(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, EndWindow, GuardEndWindow

    <2>7. \A m \in Monitors: InductiveInv /\ Digest(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Digest, GuardDigest

    <2>8. \A m \in Monitors: InductiveInv /\ DeliverAlert(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, DeliverAlert, GuardDeliverAlert

    <2>9. \A m \in Monitors: InductiveInv /\ Exit(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Exit, GuardExit

    <2>10. \A m \in Monitors: InductiveInv /\ Crash(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Crash, GuardCrash, GuardExit

    <2>11. \A m \in Monitors: InductiveInv /\ Timeout(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Timeout, GuardTimeout, GuardExit

    <2>12. \A m \in Monitors: InductiveInv /\ Cancel(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Cancel, GuardCancel

    <2>13. \A m \in Monitors: InductiveInv /\ EffectStale(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, EffectStale, GuardEffectStale

    <2>14. \A m \in Monitors: InductiveInv /\ Reconcile(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Reconcile, GuardReconcile

    <2>15. \A m \in Monitors: InductiveInv /\ Clear(m) => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, Clear, GuardClear

    <2>16. InductiveInv /\ PiCrash => InductiveInv'
      BY SMT DEF CoreInv, ArmedHasNoTerminal, Statuses, Effects, Terminals,
             AlertTerminals, InductiveInv, TypeOK, EffectFenceBound, RunningEffectCurrent,
             ArmedIdle, StaleOnlyAfterInvalidation, DisarmedCurrentNoEffect,
             RunningHasNoTerminal, NoSilentLoss, RateBound, QueueBound, DigestSound,
             AlertSound, AlertPendingSound, PiCrash

    <2>17. QED
      BY SMT, <2>1, <2>2, <2>3, <2>4, <2>5, <2>6, <2>7, <2>8, <2>9, <2>10,
             <2>11, <2>12, <2>13, <2>14, <2>15, <2>16 DEF Next, vars

  <1>3. QED
    BY <1>1, <1>2, PTL DEF SafetySpec, InductiveInv

=============================================================================
