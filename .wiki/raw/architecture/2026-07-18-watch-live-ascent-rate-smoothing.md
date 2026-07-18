Source URL: project conversation; docs/superpowers/plans/2026-07-18-watch-live-ascent-rate-smoothing.md; apps/mobile/ios/DivenaryWatchApp/Recording/DisplayAscentRateEstimator.swift; apps/mobile/ios/DivenaryWatchApp/Recording/DiveSessionRecorder.swift; apps/mobile/ios/DivenaryWatchAppTests/DisplayAscentRateEstimatorTests.swift; apps/mobile/ios/DivenaryWatchAppTests/DiveSessionRecorderAscentRateTests.swift
Collected: 2026-07-18
Published: 2026-07-18

# Watch live ascent-rate smoothing boundary

Watch의 기존 live ascent 표시는 연속한 두 raw callback만 비교해 `previous.depthMeters - current.depthMeters`를 경과 시간으로 나눈 뒤 분당 값으로 바꿨다. 수심 callback은 대략 초당 세 번 들어올 수 있으므로, 작은 sensor jitter도 callback마다 큰 spike와 0을 반복해 보이게 할 수 있었다.

`DisplayAscentRateEstimator`는 live display 전용으로 최근 유효 raw sample을 유지한다. newest accepted sample을 기준으로 5초보다 오래된 sample을 제거하고, 남은 oldest와 newest 사이가 적어도 3초여야 한다. 순수한 상승은 다음 strict 조건으로만 인정한다.

```text
oldest.depthMeters > newest.depthMeters + 0.15
netDepthDecrease = oldest.depthMeters - newest.depthMeters
rateMetersPerMinute = netDepthDecrease / elapsedSeconds * 60
```

따라서 0.15m 이하의 순수 수심 감소와 3초보다 짧은 구간은 0을 반환한다. 유효하지 않은 depth, pressure, temperature, non-finite timestamp 또는 interval, duplicate timestamp, out-of-order timestamp도 0을 반환하며 retained window를 바꾸지 않는다. `reset()`과 recorder start/cancel/completed-session reset은 retained history, published live value, transient warning을 비워 별도 session이 이전 window를 공유하지 않게 한다.

`DiveSessionRecorder`만 estimator를 `latestAscentRateMetersPerMinute`에 연결하고, 기존 transient `ascentWarningActive`는 이 smoothed value가 strict `> 9m/min`일 때만 켜진다. raw callback 수용, `lastRawSample`, 1Hz `OneHertzProfileSampler` artifact와 local persistence, sync payload/schema version, `ScubaDiveEngine`의 historical `latestAscentRateMetersPerMinute`/`maxAscentRateMetersPerMinute` 계산은 바꾸지 않는다.

이 값은 기록 화면의 비인증 보조 표시와 일시 경고 reference일 뿐이다. 감압 의무나 안전한 상승 여부를 계산하거나, 훈련 또는 인증된 다이브 컴퓨터를 대체하지 않는다.
