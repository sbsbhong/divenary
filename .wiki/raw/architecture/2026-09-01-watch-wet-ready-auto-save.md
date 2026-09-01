Source URL: docs/superpowers/specs/2026-09-01-watch-wet-ready-auto-save-design.md; docs/superpowers/plans/2026-09-01-watch-wet-ready-auto-save.md; local implementation
Collected: 2026-09-01
Published: 2026-09-01

# Watch Wet Ready and automatic local save

지원 hardware에서 물 감지와 watchOS underwater extended runtime 전달 사이에는 앱이 foreground에 있지만 Water Lock 때문에 touch를 사용할 수 없는 구간이 생길 수 있다. Divenary는 이 구간에 전체 Home 대신 `wetReady(mode:)`를 표시한다. 마지막 preferred mode를 기본값으로 사용하고 Digital Crown 회전으로 Freedive 또는 Scuba를 즉시 선택한다. Crown press는 watchOS system behavior이므로 앱 확인 입력으로 사용하지 않는다.

물 감지 자체, app-local depth threshold, 30초 timer는 recording start가 아니다. watchOS가 underwater runtime을 전달하면 coordinator가 현재 armed mode를 `PreDivePlan`에 고정하고 recorder를 한 번 시작한다. runtime이 water UI event보다 먼저 오면 persisted preferred mode를 fallback으로 사용한다. recording 뒤에는 mode를 바꾸지 않는다.

sample이 있는 real recording이 runtime invalidation으로 끝나면 coordinator가 finalized `DiveSessionRecord`를 Watch local store에 먼저 저장한다. 성공 뒤에만 recorder completed state를 정리하고 `Saved` summary를 표시한다. 실패하면 같은 record와 local session ID를 유지한 채 foreground 또는 명시적 Retry에서 다시 저장한다. real completion에는 rating, perceived exertion, visibility, water condition, note 입력과 Save/Discard/Delete가 없다. 미입력 주관 값은 `nil`, water condition은 `.unknown`이다.

Demo/debug는 read-only metrics를 공유하지만 test data 누적 방지를 위해 explicit Save/Discard를 유지한다. Watch local save와 mobile import ACK, account cloud sync, guest claim은 서로 다른 완료 경계다.

Simulator와 build는 physical Water Lock, Crown focus, actual `When Submerged` automatic launch, sensor delivery 또는 release readiness의 증거가 아니다. 지원 Apple Watch에서 shallow Wet Ready, Crown selection, runtime adoption, mode lock, touch 없는 local save, forced save-retry를 별도 검증해야 한다.
