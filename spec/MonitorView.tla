------------------------------ MODULE MonitorView ------------------------------
\* The presentation view of the verified monitor machine.
\*
\* The board the tool renders and the notices the injector emits are total
\* functions of the core state: a status, a terminal kind, and the accounting
\* counters. Nothing here re-derives lifecycle state from the log or the text;
\* the log path and the echoed payload are opaque and never appear in a guard.
\*
\* This module adds accounting and notice properties to CoreInv. SafetyViews
\* in MonitorSystemProof proves them inductively; TLC checks the fixture too.
\* -------------------------------------------------------------------------

EXTENDS MonitorSystem, TLC

Running == {m \in Monitors : status[m] = "running"}
Armed == Running
Alertable(m) == terminal[m] \in AlertTerminals
Accounted(m) == delivered[m] + queued[m] + suppressed[m] + digested[m]

\* The accounting law: what was produced is exactly what is accounted for.
AccountingLaw ==
    \A m \in Monitors : Accounted(m) = produced[m]

\* An alert terminal always has its notice pending or already sent.
NoticeComplete ==
    \A m \in Monitors : Alertable(m) => (alertPending[m] \/ alertSent[m])

ViewInv == CoreInv /\ AccountingLaw /\ NoticeComplete

=============================================================================
