# Pre-Dive Readiness Immediate Work Design

## Context

`diving-app`은 레크리에이션 다이빙 기록과 사후 리뷰를 위한 Apple Watch companion app이다. 인증된 다이브 컴퓨터, 감압 컴퓨터, 의료기기, 생명 유지 장치, 비상 판단 시스템이 아니다.

현재 실제 iPhone과 Apple Watch를 사용할 수 있다. 깊은 물에서 실제 프리다이빙 또는 스쿠버를 수행하기 전까지는 시간이 남아 있으므로, 건식 실기기 검증과 얕은 물통 또는 수영장 침수 테스트까지 수행할 수 있다. 실제 프리다이빙과 스쿠버에서만 확인 가능한 동작은 별도 real-dive gate로 남긴다.

최근 구현은 대용량 Watch session을 `WCSession.transferFile`로 보내는 경로, mobile durable inbox, local import acknowledgement, debug/test capture provenance를 포함한다. 그러나 다음 즉시 작업은 아직 완료되지 않았다.

1. 연결 해제 중 저장한 Watch session을 재연결 뒤 자동 또는 수동으로 import할 때 보고된 crash를 실제 기기에서 재현하고 검증한다.
2. `RealDepthSensorProvider`가 첫 수온 callback 전에 depth sample의 수온을 `0°C`로 기록하는 동작을 제거한다.
3. Watch 전송 완료, iPhone local repository import acknowledgement, 미래 cloud sync 상태가 타입과 UI에서 같은 `sync` 용어로 섞이는 문제를 정리한다.

이 작업이 끝나면 나머지 모든 미구현 작업을 `P0 pre-dive`로 재분류한다. 같은 P0 안의 wave는 중요도 차등이 아니라 선행 의존성에 따른 실행 순서다.

## Goals

- 현재 빌드의 건식 실기기 WatchConnectivity baseline을 기록한다.
- 연결 해제, 재연결, 자동 import, 수동 drain, 중복 delivery, 대용량 transfer 경로에서 crash와 data loss가 없는지 검증한다.
- 재현된 crash는 원인을 수정하고 자동 회귀 테스트를 추가한다.
- 실제 수온이 도착하기 전 값을 unknown으로 보존하고 `0°C` 측정값을 만들지 않는다.
- Watch transfer, local import acknowledgement, future cloud sync 상태를 코드, 저장 모델, UI 문구에서 분리한다.
- 전체 미구현 작업을 `P0 pre-dive` inventory로 만들고 dependency wave와 real-dive gate를 명확히 한다.

## Non-Goals

- 실제 프리다이빙 또는 스쿠버를 수행하거나 그 결과를 검증 완료로 기록하지 않는다.
- 얕은 침수 테스트를 깊은 수심, 장시간 잠수, 실제 상승·하강 환경의 안정성 증거로 사용하지 않는다.
- NDL, ceiling, tissue loading, gas switching safety, decompression obligation, emergency decision을 계산하지 않는다.
- 이번 작업에서 Supabase, 인증, Memory/share 등 전체 P0 기능을 구현하지 않는다. 이번 작업은 해당 항목을 P0로 재분류하고 후속 spec 순서를 만드는 데까지다.
- production 사용자용 WatchConnectivity 진단 화면을 추가하지 않는다.

## Chosen Approach

위험 우선 통합 패스를 사용한다.

1. 변경 전 실기기 baseline에서 reconnect crash를 먼저 재현한다.
2. 재현 결과를 바탕으로 Watch import 경로의 concurrency 또는 transport 문제를 최소 범위로 수정한다.
3. temperature unknown 처리와 sync vocabulary 분리를 구현한다.
4. 자동 테스트와 변경 후 실기기 regression을 수행한다.
5. wiki와 `pending-work` skill을 전체 `P0 pre-dive` 체계로 갱신한다.

코드 변경 전 baseline을 먼저 남겨야 최근 file-transfer 수정과 이후 변경의 영향을 구분할 수 있다.

## WatchConnectivity Architecture

### Data Flow

Watch session import는 다음 순서를 사용한다.

```text
Watch local save
  -> sendMessage / transferUserInfo / transferFile
  -> iPhone durable native inbox
  -> shared import coordinator
  -> runtime contract validation
  -> persistent local repository save and dedupe
  -> native inbox payload acknowledgement
  -> Watch local-import acknowledgement
```

대용량 payload는 현재 `transferFile` 경로를 유지한다. 작은 payload는 기존 reachable message와 background transfer 경로를 사용한다. Transport 선택은 local import와 cloud 상태 의미를 바꾸지 않는다.

### Shared Import Coordinator

자동 native event와 Logbook 수동 drain은 같은 import coordinator를 통과한다. Coordinator는 process 안에서 import 작업을 직렬화하고 다음 identity를 사용한다.

- Durable delivery identity: `payloadId`
- Repository identity: Watch session의 explicit import key

같은 `payloadId`가 동시에 들어오면 하나의 in-flight promise로 합치고 local import와 native acknowledgement를 한 번만 수행한다. 서로 다른 payload가 같은 import key를 가지면 순차로 import하고 native payload는 각각 acknowledgement하지만 repository row는 기존 merge 규칙에 따라 하나로 dedupe한다.

### Error Handling

- Runtime contract validation에 실패한 durable payload는 기존 정책대로 invalid payload로 기록하고 native inbox에서 제거한다. Watch import 성공 acknowledgement와는 구분한다.
- Repository import 또는 final save가 실패하면 native payload를 제거하지 않고 Watch에 import 성공 acknowledgement를 보내지 않는다.
- Local save 뒤 Watch acknowledgement 전송만 실패하면 저장된 mobile row는 유지한다. Watch가 payload를 다시 보내면 import key로 dedupe한다.
- Source plan completion 실패는 이미 저장된 Watch log를 롤백하지 않는다. Plan completion failure는 별도로 기록한다.
- Catch-all로 crash를 숨기지 않는다. 실기기 crash report와 console log에서 원인을 확인할 수 있어야 한다.

## Device Validation Design

### Baseline Run

변경 전 현재 commit의 build를 동일한 paired iPhone과 Apple Watch에 설치한다. 실행 기록에는 다음 정보를 남긴다.

- Git commit과 app build identifier
- iPhone model, iOS version
- Apple Watch model, watchOS version
- pairing, installation, reachability 상태
- capture mode와 session sample count
- payload byte size와 selected transport
- iPhone foreground, background, killed 상태
- 자동 import와 수동 drain 결과
- duplicate row 여부와 Watch acknowledgement 결과
- crash report 또는 관련 console log

### Dry-Device Matrix

1. 연결된 상태에서 짧은 Test Scuba session 자동 import
2. 연결된 상태에서 짧은 Test Freedive session 자동 import
3. 연결 해제 상태에서 session 저장 후 재연결 자동 import
4. 재연결 직후 자동 import와 Logbook 수동 sync 동시 실행
5. 자동 import 실패 또는 지연 상태에서 수동 sync 재시도
6. 동일 payload 반복 delivery와 repository dedupe
7. DEBUG deterministic large-session fixture를 이용한 file transfer
8. iPhone foreground, background, killed 상태의 delivery와 다음 launch drain
9. Mobile planned dive의 Watch 전달, recording, local import, source plan completion
10. Mobile local save 후 Watch session의 transfer status 갱신

DEBUG large-session fixture는 production UI나 production contract에 새 상태를 추가하지 않는다. 충분한 sample을 가진 deterministic test session을 기존 debug/test capture provenance로 생성해 transport threshold를 넘기는 용도로만 사용한다.

### Shallow-Water Matrix

즉시 작업 이후 P0 device gate에서 얕은 물통 또는 수영장으로 다음을 확인한다.

- depth, pressure, temperature callback availability와 cadence
- 첫 temperature callback 전 unknown 처리
- finite-value filtering과 depth sensor error handling
- app foreground/background 전환
- auto-launch prompt와 handoff 동작
- water lock 및 제한된 interaction 환경
- session persistence와 물 밖 복귀 후 sync

이 결과는 얕은 침수 환경에만 적용한다.

## Temperature Model

`DepthSample.waterTemperatureCelsius`는 optional 측정값으로 바꾼다.

- Depth와 pressure가 유효하면 temperature가 없어도 sample을 기록한다.
- `isValidRecordingSample`은 temperature가 존재할 때만 finite인지 확인한다.
- `RealDepthSensorProvider`는 최신 temperature가 없을 때 `nil`을 전달한다.
- Scuba average temperature는 값이 있는 sample만 평균한다. 온도 sample이 없으면 summary temperature는 `nil`이다.
- Freedive segmentation과 depth/ascent 계산은 temperature 유무에 의존하지 않는다.
- Watch live UI는 `nil`을 `--`로 표시한다. Watch/mobile summary와 detail은 온도 metric과 temperature profile을 값이 생길 때까지 숨긴다.
- Sync encoder와 mobile validator는 contract의 existing optional temperature 의미를 사용한다.
- `0°C`는 실제 센서가 0을 보고한 경우에만 측정값으로 보존한다.

별도 estimated temperature나 품질 추정치를 생성하지 않는다. 이 단계의 품질 표현은 measured value의 존재 여부와 `captureMode` provenance다.

## Sync Vocabulary And Persistence

상태를 다음 세 층으로 분리한다.

### Watch Transfer Status

Watch의 저장 session이 iPhone으로 전달되고 local import acknowledgement를 받았는지를 나타낸다. Existing Watch payload의 `pending | synced | failed` 값은 이 의미로만 사용하고 `watchCapture.session.syncStatus`에 원본을 보존한다.

### Local Import Acknowledgement

iPhone local repository 저장 성공 뒤 Watch로 보내는 protocol event다. Mobile dive log의 장기 sync 상태가 아니며 별도 persistent badge 값으로 사용하지 않는다.

### Cloud Sync Status

향후 Supabase remote repository가 생겼을 때 mobile log의 원격 저장 상태를 나타낸다. 새 mobile code는 `cloudSyncStatus: 'notConfigured' | 'pending' | 'synced' | 'failed'`를 사용한다. Supabase가 없는 현재에는 모든 mobile log가 `notConfigured`이고 UI는 cloud badge와 cloud filter를 숨긴다. Local save를 `Cloud synced` 또는 모호한 `Synced`로 표시하지 않는다.

기존 persisted mobile entry의 `syncStatus`는 backward-compatible read adapter로 `cloudSyncStatus`에 migration한다. 현재 저장소에는 실제 remote backend가 없으므로 legacy `localOnly | pending | synced | failed` 값은 모두 `notConfigured`로 migration한다. Migration은 manual fields, raw Watch capture, provenance, timestamps를 바꾸지 않는다. 새 write path는 `cloudSyncStatus`만 사용한다.

UI filter, status pill, toast, notification, test fixture도 같은 vocabulary를 사용한다. Watch session list의 transfer badge는 유지하되 mobile Logbook의 cloud badge와 혼동되지 않는 문구를 사용한다.

## Automated Verification

구현은 다음 regression coverage를 가져야 한다.

- Auto event와 manual drain의 concurrent import serialization
- Duplicate `payloadId` acknowledgement와 same import-key repository dedupe
- Open session과 ended session의 explicit import-key behavior
- Repository failure에서 no-ack and retry preservation
- Acknowledgement failure 뒤 duplicate delivery dedupe
- Large payload transport selection과 file inbox import
- Optional temperature encode, decode, persistence, average, UI placeholder
- Legacy `syncStatus` to `cloudSyncStatus` migration without raw capture loss
- Local import notification과 cloud status wording separation
- Existing planned-dive enrichment and completion behavior

관련 gate는 변경 범위에 따라 다음 순서로 실행한다.

1. Focused Jest and Swift tests
2. `yarn mobile:typecheck`
3. `yarn watch:build`
4. Contract가 바뀌면 `yarn check:quick`
5. 일반 handoff 전에 `yarn codex:check`
6. 변경 후 dry-device regression matrix

실행하지 않은 command나 physical-device case를 pass로 기록하지 않는다.

## P0 Pre-Dive Backlog Model

모든 미구현 작업은 같은 `P0 pre-dive` priority를 갖는다. Wave는 dependency order만 표현한다.

### Wave 0: Immediate Hardening

- WatchConnectivity reconnect baseline, reproduction, fix, regression
- Temperature unknown preservation
- Watch transfer, local acknowledgement, cloud sync vocabulary separation

### Wave 1: Dry Physical-Device Validation

- Pairing, installation, entitlement and embedded companion validation
- Foreground, background, killed-app delivery
- Automatic retry, manual drain, duplicate delivery and long retry behavior
- Large-session file transfer and acknowledgement
- Planned-dive mobile-to-watch flow
- Notification permission, delivery and press routing
- Crash/reboot persistence and recovery evidence

### Wave 2: Shallow Submersion Validation

- Real depth, pressure and temperature callback behavior
- Initial unknown values, dropout, spike, flatline and sensor error handling
- Auto-launch and background handoff
- Water lock and constrained interaction
- 40m support-boundary behavior by simulation plus available shallow-device evidence
- Battery and lifecycle observations available without real diving

### Wave 3: Remote Foundation

- Supabase project boundary and environment setup
- Authentication and user ownership
- Database schema, RLS, generated database types
- Remote repository behind existing mobile repository boundaries
- Local-to-remote migration, conflict, retry and data-loss policy
- Cloud backup and honest cloud status UI

### Wave 4: Product Completion

- Logbook detail, search, filters, profile review and export
- Planbook completion and repeated-use workflow
- Memory/share redesign and media ownership policy
- Settings, notification and recovery UX
- Data migration and app-update compatibility
- Remaining approved mobile and Watch UX work

### Wave 5: Safety And Release Readiness

- Safety-stop versus mandatory/decompression terminology and provenance model
- Future decompression import boundary without implementing decompression calculation
- Contract and generated Swift integration decisions
- Accessibility, localization and safety-copy audit
- Full pre-dive regression and release checklist

### Real-Dive Gate

실제 프리다이빙 또는 스쿠버가 있어야만 검증할 수 있는 항목은 P0 implementation과 분리해 explicit gate로 유지한다.

- 실제 depth profile과 sensor cadence under sustained descent/ascent
- 장시간 underwater lifecycle과 battery behavior
- 실제 수면 복귀와 segment/session termination behavior
- 실제 환경의 connectivity delay와 post-dive recovery
- 수중 가독성, haptic 전달성, 조작성

Real-dive gate가 통과하기 전에는 해당 동작을 production-validated 또는 safety-critical truth로 설명하지 않는다.

## Documentation Changes After Implementation

- `.agents/skills/pending-work/SKILL.md`: 전체 미구현 항목을 `P0 pre-dive`, dependency wave, real-dive gate로 보고하도록 갱신한다.
- `.wiki/wiki/architecture/implementation-priorities.md`: 즉시 작업 완료 상태와 새 P0 wave를 기록한다.
- `.wiki/wiki/questions/open-questions.md`: 해결된 온도와 vocabulary 질문을 닫고 physical-device 결과가 필요한 질문을 유지한다.
- `.wiki/wiki/architecture/sync-flow.md`: coordinator, acknowledgement and cloud status boundary를 반영한다.
- `.wiki/wiki/architecture/watch-app.md`와 `.wiki/wiki/architecture/mobile.md`: optional temperature와 상태 ownership을 반영한다.
- `.wiki/wiki/project/diving-app-qa-test-plan.md`: dry-device, shallow-water, real-dive gate를 분리한다.
- `.wiki/raw/`: 구현 결과와 physical-device evidence를 source material로 추가한다.

## Completion Criteria

이번 spec은 다음 조건을 모두 만족할 때 완료된다.

1. 변경 전 dry-device baseline 결과가 기록되어 있다.
2. Reconnect crash가 재현됐다면 원인 수정과 regression test가 있고, 재현되지 않았다면 기기·OS·build·matrix 결과가 명시되어 있다.
3. 온도 callback 전 sample이 `0°C`를 만들지 않고 unknown으로 end-to-end 보존된다.
4. Watch transfer, local import acknowledgement, cloud sync가 타입과 UI에서 구분된다.
5. Concurrent automatic/manual import와 duplicate delivery가 data loss나 duplicate row를 만들지 않는다.
6. 관련 automated verification과 변경 후 dry-device regression 결과가 기록되어 있다.
7. 전체 미구현 작업이 `P0 pre-dive` wave와 별도 real-dive gate로 wiki와 `pending-work` skill에 반영되어 있다.
8. 앱의 non-certified safety boundary가 유지된다.
