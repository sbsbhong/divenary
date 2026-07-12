Source URL: docs/superpowers/specs/2026-07-12-watch-profile-file-sync-reliability-design.md
Collected: 2026-07-12
Published: 2026-07-12

# 1Hz 프로파일 파일 저장과 WatchConnectivity 신뢰성 결정

사용자가 승인한 범위는 장시간 다이빙 기록을 초당 한 샘플의 프로파일 파일로 저장하고, 세션 크기와 무관하게 `transferFile` 하나로 전달하는 것이다. 별도 chunk protocol은 만들지 않는다. 원시 센서 콜백은 실시간 UI와 기록 엔진에 계속 사용하되, 영구 프로파일은 세션 시작 기준 1초 bucket마다 마지막 실제 관측값 하나를 남긴다. 같은 bucket의 최소·최대 수심과 마지막 실제 수온을 함께 보존하고, 관측이 없는 초는 합성하지 않는다.

Watch는 활성 기록 중 finalized sample을 NDJSON journal에 append한다. 저장 시 session별 immutable JSON artifact와 작은 manifest를 만들며 revision, SHA-256, byte count, sample count로 identity를 구성한다. `syncStatus` 변경은 manifest만 갱신한다. 기존 단일 `savedDiveSessionRecords.json`은 artifact 검증이 끝난 record부터 이동하고 전체 검증 전에는 원본을 삭제하지 않는다.

세션 본문은 작은 세션도 `sendMessage`나 `transferUserInfo`로 보내지 않고 항상 `transferFile`을 사용한다. planned dive와 acknowledgement 같은 control message는 기존 WatchConnectivity control channel을 유지한다. sender의 canonical artifact는 file-transfer callback에서 삭제하지 않으며 application-level acknowledgement가 revision과 digest까지 일치해야 `synced`가 된다.

iPhone native receiver는 delegate callback 안에서 임시 `WCSessionFile`을 Application Support로 복사하고 byte count와 digest를 확인한다. UserDefaults에는 payload body가 아니라 작은 file descriptor만 저장한다. 모바일 repository가 profile과 metadata를 모두 저장한 뒤 acknowledgement를 durable outbox에 먼저 기록하고 inbound file을 삭제한다. WCSession activation이 끝난 뒤 outbox를 `transferUserInfo`로 제출한다.

모바일 로그북 metadata에는 최대 160개의 peak-preserving preview만 둔다. 전체 profile은 session/revision별 저장 항목으로 한 번만 보관하고 detail 화면 진입 시 지연 로드한다. Supabase가 추가될 때 session metadata row와 profile object를 분리하는 같은 경계를 유지한다.

알림 설정은 preferences hydration 완료 뒤 inbox를 drain한다. foreground import는 toast, background import는 opt-in local notification을 사용한다. iOS notification permission이 이미 denied이면 다시 prompt할 수 없으므로 Settings 앱으로 이동하는 복구 경로를 제공하고 복귀 시 권한을 다시 읽는다. 이는 외부 push provider가 없는 force-quit remote push를 보장하지 않는다.

