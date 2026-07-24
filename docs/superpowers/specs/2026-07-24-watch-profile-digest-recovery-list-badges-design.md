# Watch Profile Digest Recovery and List Badges Design

## Context

실제 Apple Watch 세션을 iPhone으로 가져오면 로컬 Logbook에는 기록이 생성되지만, 로그인 뒤 guest claim 사전 검사에서 모든 워치 기록이 `profile_corrupt`로 보류된다. 기존 14개뿐 아니라 새로 기록한 15번째 세션도 같은 결과를 보여 개별 파일 손상보다 전송·검증 의미의 구조적 불일치를 의심해야 한다.

코드 추적 결과 Watch는 `sessionEnded` 전체 JSON artifact의 SHA-256을 `WatchConnectivityPayload.sha256`으로 전달한다. Mobile import는 이 값을 로컬 `watchCapture.profile.sha256`에 저장하지만, guest claim과 account sync는 `JSON.stringify(fullSamples)` 바이트의 SHA-256으로 해석한다. 같은 세션이어도 해시 대상이 다르므로 정상 profile이 항상 손상으로 판정된다.

로그인한 목록은 account partition과 claim에서 보류된 guest partition을 합쳐 보여주지만, 현재 `기기 저장` 문구가 날짜 옆의 작은 보조 텍스트라 저장 위치를 알아보기 어렵다. 데모 세션도 상세 화면에만 표시되고 목록에서는 일반 워치 기록과 구분되지 않는다.

## Product Decisions

- Watch 전체 artifact 해시와 Mobile profile 샘플 해시를 서로 다른 필드와 의미로 관리한다.
- 기존 잘못 저장된 해시는 명시적인 legacy 형태로만 복구한다. 수정 이후의 진짜 profile 해시 불일치는 자동 보정하지 않는다.
- 기존 guest 원본과 수심 샘플은 복구 과정에서 수정하거나 삭제하지 않는다.
- `다시 검사`가 기존 retained snapshot을 재평가할 때 복구된 profile을 새 claim snapshot에 포함한다.
- 로그인 중 `ownerUserId`가 없는 로그·계획에만 `이 기기에만 저장` 경고형 배지를 표시한다.
- 계정 소유 항목에는 대응 배지를 표시하지 않는다. 기기에 남은 항목이 없으면 목록에는 저장 위치 배지가 하나도 나타나지 않는다.
- 로그인하지 않은 상태에서는 모든 항목이 기기 principal에 있으므로 저장 위치 배지를 표시하지 않는다.
- 워치 로그의 `captureMode === 'demo'`이면 저장 위치와 독립적인 `데모` 배지를 표시한다.
- 계획에는 `captureMode`가 없으므로 데모 배지를 표시하지 않는다.

## Explored Approaches

### A. 혼합 목록에서 모든 행에 `계정` 또는 `이 기기` 표시

비교는 명확하지만 정상 상태에서도 모든 account 행에 반복 표식이 붙어 목록의 정보 밀도를 높인다.

### B. `계정`과 `이 기기` 섹션으로 목록 분리

저장 위치는 가장 선명하지만 로그의 시간순 정렬과 계획의 진행 흐름이 끊긴다.

### C. 기기에만 남은 항목에 경고형 표시

account 항목은 기본값으로 두고 예외만 표시한다. 가져오기 문제가 해소되면 표시가 자연스럽게 사라지고 기존 정렬도 유지된다. **채택한다.**

## Data Model

`DiveLogWatchCapture.profile`은 다음 의미를 갖는다.

```ts
type DiveLogWatchProfileReference = {
  storageKey: string;
  contentRevision: string;
  sampleCount: number;
  sha256?: string; // JSON.stringify(fullSamples)의 UTF-8 SHA-256
  artifactSha256?: string; // Watch sessionEnded 전체 artifact의 SHA-256
};
```

- `sha256`은 profile Storage, guest claim object, account sync object의 sample-array bytes를 검증한다.
- `artifactSha256`은 WatchConnectivity transport identity와 같은 artifact가 다시 도착했는지 확인한다.
- remote database와 Supabase Storage contract에는 `sha256`만 전달한다. `artifactSha256`은 mobile local metadata다.
- 기존 persisted profile reference는 `artifactSha256`이 없어도 parse해야 한다.

## New Watch Import Flow

1. iOS native inbox는 기존처럼 Watch artifact의 `byteCount`와 `sha256`을 전체 file bytes에 대해 검증한다.
2. React Native는 검증된 payload를 strict parser로 읽는다.
3. full samples를 profile storage에 원자적으로 저장한다.
4. Mobile은 검증된 full samples를 `JSON.stringify`하고 UTF-8 SHA-256을 계산한다.
5. profile reference에는 계산한 sample digest를 `sha256`, Watch payload digest를 `artifactSha256`으로 저장한다.
6. duplicate 판정은 `localSessionId + contentRevision + artifactSha256`을 사용한다. legacy row는 기존 `sha256`을 artifact digest로 간주해 같은 payload를 중복 저장하지 않는다.
7. account principal로 직접 import한 경우에도 account outbox는 sample digest를 사용하므로 즉시 profile upload가 가능하다.

Watch의 `captureMode`가 `real` 또는 `demo`인지는 이 흐름을 바꾸지 않는다.

## Legacy Recovery

잘못 저장된 기존 row는 다음 조건을 모두 만족할 때만 legacy transport-digest row로 취급한다.

- `watchCapture.profile`이 존재한다.
- `profile.sha256`은 존재하지만 `profile.artifactSha256`은 없다.
- profile storage에서 full samples를 읽을 수 있다.
- strict sample parser를 통과한다.
- sample count가 profile reference와 일치한다.
- 모든 sample의 `localSessionId`가 row의 watch session과 일치한다.

이 경우 기존 `sha256` 값을 `artifactSha256`으로 보존하고, full samples bytes에서 계산한 digest를 새 `sha256`으로 사용한다. guest claim preparation은 immutable snapshot의 row만 정규화하고 guest 원본 metadata나 profile file을 수정하지 않는다. claim 완료 시 account partition에 올바른 두 digest를 가진 row가 발행되고, 기존 guest cleanup 규칙에 따라 원본이 제거된다.

account partition에 이미 존재하는 legacy row는 outbox 준비 시 같은 검사를 통과한 뒤 local metadata를 원자적으로 갱신하고 sample digest로 upload한다.

`artifactSha256`이 이미 존재하는 row의 `sha256` 불일치는 수정 이후의 실제 무결성 오류로 간주한다. 이 경우 기존 quarantine과 `이 기기에만 저장` 동작을 유지하고 자동 복구하지 않는다.

## List Presentation

### Logbook

- `captureMode === 'demo'`: 중립적인 `데모` capsule.
- 로그인 중 `ownerUserId === undefined`: 절제된 주황 계열 `이 기기에만 저장` capsule.
- 두 조건을 모두 만족하면 `데모`, `이 기기에만 저장` 순서로 함께 표시한다.
- account 일반 기록은 badge가 없다.
- badge row는 제목 아래에서 날짜/측정값과 분리하고 좁은 폭과 Dynamic Type에서 wrap한다.

### Planbook

- 로그인 중 `ownerUserId === undefined`인 계획 행에만 `이 기기에만 저장`을 표시한다.
- 같은 device-only 상태를 상단 active plan panel에도 표시한다.
- account 계획에는 badge가 없다.

### Visual and Copy

- `데모`는 정보 상태이며 muted/secondary semantic tone을 사용한다.
- `이 기기에만 저장`은 데이터 손상을 뜻하지 않으므로 red나 destructive icon을 사용하지 않는다. Apple Settings의 주의 상태처럼 warning semantic tone, device icon, 명시적 문구를 함께 사용한다.
- 색만으로 의미를 전달하지 않는다.
- 한국어: `데모`, `이 기기에만 저장`
- 영어: `Demo`, `Only on this device`
- accessibility label은 제목, 데모 여부, 저장 위치를 한 번만 읽는다.

## Failure and Recovery

- profile file missing, malformed JSON, sample count mismatch, session mismatch: 기존 `profile_missing` 또는 `profile_corrupt` retained 상태를 유지한다.
- legacy recovery가 가능한 digest mismatch: 새 snapshot digest로 claim을 계속한다.
- versioned row의 digest mismatch: 진짜 `profile_corrupt`로 보류한다.
- network, Auth, Supabase 실패: 올바른 sample digest를 만든 이후의 기존 resumable claim 규칙을 사용한다.
- partial claim: 성공한 account rows는 badge 없이 보이고, retained guest rows만 `이 기기에만 저장` badge를 유지한다.
- 원격 요청 전에 모든 item이 retained이면 remote batch를 만들지 않는다.

## Testing

### Digest and Import

- Watch artifact digest와 sample-array digest가 다른 실제 형태의 fixture로 기존 실패를 재현한다.
- 신규 WatchConnectivity import가 `sha256`과 `artifactSha256`을 각 의미에 맞게 저장한다.
- 같은 artifact 재수신을 중복으로 처리하지 않는다.
- real/demo capture 모두 같은 digest flow를 통과한다.

### Legacy Recovery

- 기존 transport digest만 있는 guest row가 full sample 검증 뒤 claimable snapshot으로 변환된다.
- 변환된 snapshot과 account publication이 sample digest와 artifact digest를 모두 보존한다.
- legacy account outbox row가 안전하게 정규화된다.
- missing, malformed, sample-count mismatch, session mismatch는 계속 retained/failure다.
- `artifactSha256`이 있는 versioned row의 digest mismatch는 자동 복구되지 않는다.

### Lists

- authenticated device-only log에 `이 기기에만 저장`이 보인다.
- account log에는 저장 위치 badge가 없다.
- demo log에는 `데모`가 보인다.
- device-only demo log에는 두 badge가 순서대로 보인다.
- guest 상태에서는 저장 위치 badge가 없다.
- device-only plan row와 active panel에는 warning badge가 보이고 account plan에는 보이지 않는다.
- Korean/English copy와 accessibility label을 검증한다.

### Gates

1. focused Jest tests for profile bytes, WatchConnectivity import, guest claim, account mutation, Logbook, Planbook, i18n
2. `yarn mobile:typecheck`
3. full mobile Jest suite, with the pre-existing native-source baseline mismatch tracked separately until the user's unrelated watch/Xcode work is present on merged `main`
4. `yarn ios:build`
5. `yarn codex:check` after wiki update
6. physical iPhone + Apple Watch: existing 15 rows recheck, account import, force quit/relaunch, new real session, new demo session

## Wiki Update

구현이 검증되면 현재 code와 이 설계를 raw source로 보존하고 다음 durable knowledge를 갱신한다.

- mobile/watch sync에서 artifact digest와 profile digest의 의미
- guest claim legacy recovery 경계
- account와 deferred guest rows의 목록 표시 규칙
- 전체 artifact digest를 sample digest로 재사용하면 안 된다는 recurring pitfall

## Non-Goals

- Supabase schema, migration, RLS, Edge Function 변경
- Watch artifact format 또는 WatchConnectivity acknowledgement 의미 변경
- profile sample 자동 생성, sample content rewrite, guest 원본 강제 삭제
- account/device 섹션 분리나 저장 위치 필터
- 계획에 데모 개념 추가
- production Supabase 승격 또는 account deletion
- 감압, 상승, 비상 판단 등 safety-critical 기능

## Self-Review

- 기존 15개 복구는 marker가 없는 legacy shape에만 허용하고 versioned mismatch는 계속 실패한다.
- artifact와 sample digest의 소비자를 분리해 같은 오류가 account direct import에서도 재발하지 않는다.
- UI는 예외인 device-only row만 강조해 정상 account 목록의 소음을 늘리지 않는다.
- demo와 storage location을 독립적인 상태로 표현한다.
- raw sample, guest 원본, Supabase contract, Watch ACK 의미를 바꾸지 않는다.
