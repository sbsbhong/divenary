Source URL: docs/superpowers/specs/2026-08-02-safety-stop-rearm-after-redescent-design.md
Collected: 2026-08-02
Published: 2026-08-02

# Safety stop rearm after redescent

The watch safety-stop controller currently treats `completed` as a terminal state. Once the recommended three-minute countdown reaches zero, all later depth samples are ignored. A diver who descends again during the same scuba recording therefore never receives another safety-stop reminder.

After a completed safety stop, reaching a current depth of at least 10 meters rearms the existing three-minute recommended safety-stop reminder. The threshold reuses `SafetyStopConfiguration.armDepthMeters`, depends on the current depth sample rather than historical maximum depth, and is a fixed reminder rule rather than a physiological or decompression calculation.

The controller reuses `armed`. Rearming resets `remainingSeconds` to 180 seconds and `timeInZoneSeconds` to zero, and clears `startedAt`, `completedAt`, and outside-zone timing state. Entering the existing 2.7-6.3 meter counting zone then starts a fresh countdown.

The feature remains a rule-based recommended reminder. It does not claim that a diver is safe to ascend, that decompression is complete, or that three minutes is sufficient for a particular physiological state. It does not replace a certified dive computer or dive plan.
