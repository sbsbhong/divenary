Source URL: project conversation; .superpowers/sdd/final-review-fix-brief.md; apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift; apps/mobile/ios/DivenaryWatchApp/Storage/DiveProfileArtifactStore.swift; apps/mobile/ios/DivenaryWatchApp/Storage/DiveSessionStore.swift; apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift; apps/mobile/ios/DivenaryWatchApp/Views/SimulatedRecordingFlowView.swift
Collected: 2026-07-18
Published: 2026-07-18

# Watch 기록 내구성과 경로 복구 경계

Watch recording은 active metadata와 NDJSON journal을 모두 만들 수 있을 때만 시작한다. `DiveSessionRecorder.startSession`은 성공 여부를 반환하며, journal 준비 실패 시 sensor, timer, engine, runtime session을 시작하지 않고 local session을 active로 노출하지 않는다. manual과 Action Button start는 recorder가 실패하면 runtime을 만들거나 end action을 제공하지 않는다. watchOS가 이미 넘긴 adopted runtime은 recorder 실패 뒤에도 system session ownership을 유지한 채 invalidation을 한 번만 요청하고, Divenary는 compact persistence-error 화면만 표시한다.

각 1Hz sample append는 `recording-pending.json` sidecar에 journal byte offset과 완전한 NDJSON line을 atomic하게 먼저 기록한다. append 결과가 불확실한 상태에서 retry하면 journal suffix를 sidecar와 대조한다. line 전체가 이미 있으면 중복 append 없이 pending state만 제거하고, sidecar line의 prefix만 기록됐으면 해당 offset까지 잘라낸 뒤 line을 다시 기록한다. sidecar가 해결되기 전에는 다음 sample을 append하지 않는다. 이 정책은 raw callback 처리, `OneHertzProfileSampler`, canonical sync artifact, generated contract와 historical ascent payload를 바꾸지 않는다.

Recovery는 session directory마다 격리한다. newline으로 끝난 모든 NDJSON record는 strict decode하며, newline이 없는 마지막 record만 별도로 다룬다. 마지막 record가 decode되면 newline을 보완하고, decode되지 않으면 앞선 durable newline boundary까지만 보존한다. metadata mismatch, interior corruption, invalid pending state처럼 복구할 수 없는 active state는 session directory 아래 `Quarantine/<UUID>/`로 active metadata, journal, pending sidecar만 옮긴다. 같은 directory의 canonical `session-<revision>.json` artifact와 manifest identity는 이동하거나 무효화하지 않는다. 따라서 한 session의 corruption이 다른 interrupted session recovery를 막지 않는다.

Demo/debug flow는 external real destination에 가려질 때 unfinished local recording을 정리한다. cleanup 성공 뒤 route가 다시 보이면 lifecycle이 dismissal을 요청해 Home으로 돌아간다. summary cleanup이 실패하면 summary를 유지해 save/discard를 다시 시도할 수 있고, active recording cleanup이 실패하면 별도 retry state를 유지한다. recorder start 자체가 실패하면 retry 또는 Home dismissal을 제공한다. 정상 demo/debug recording의 Digital Crown depth control과 surface-gated touch ending은 그대로다.

Real recording은 app-scoped service graph 하나, adopted-session semantics, touch end control 부재를 유지한다. local 3m depth auto-start와 app-side 10-minute timer는 추가하지 않는다. surfaced Action Button end의 `>=180s` unit-test policy와 watchOS가 소유하는 Water Lock/runtime invalidation 경계도 바꾸지 않는다.

이 변경은 저장 및 복구 신뢰성과 화면 전환 오류 처리만 다룬다. physical depth/pressure/temperature delivery, signed entitlement/profile, 실제 `When Submerged` auto-launch, Water Lock/Crown ending, Action Button hardware start/end, watchOS out-of-water timeout은 모두 지원 hardware에서 아직 검증되지 않았다. 앱은 비인증 기록 companion이며 감압, 안전한 상승, 비상 결정을 계산하거나 인증된 다이브 컴퓨터를 대체하지 않는다.
