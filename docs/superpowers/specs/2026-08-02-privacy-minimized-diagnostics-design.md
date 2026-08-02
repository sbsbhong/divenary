# Privacy-Minimized Mobile and Watch Diagnostics Design

Date: 2026-08-02

## 문제

웹 개발에서는 브라우저의 화면과 console을 즉시 확인할 수 있지만, React Native
실기기와 Apple Watch에서 발생한 문제는 개발 시점에 연결된 console이 없으면 사건의
순서를 복구하기 어렵다. 필드 테스트 중 발견한 문제를 사람이 기억했다가 설명하는
방식도 background 전환, WatchConnectivity 재시도, local-first 저장과 account sync가
겹치는 흐름을 정확히 재현하기에 부족하다.

현재 모바일은 최상위 render failure와 일부 sync 실패를 `console.warn/error`로
기록한다. Watch는 한 경로만 `OSLog.Logger`를 사용하며 일부 저장 실패는
`assertionFailure`에 머문다. 앱이 자체적으로 보존하고 내보낼 수 있는 통합 진단
journal은 아직 없다.

## 목표

- 모바일과 Watch의 중요한 상태 전환을 구조화된 event로 기록한다.
- Watch의 정제된 진단 event를 iPhone에 자동 복사해 field-test timeline을 보존한다.
- 사용자가 문제 발생 시점을 고정 분류로 표시하고 나중에 하나의 incident로 분석할
  수 있게 한다.
- 사용자가 명시적으로 내보낸 단일 JSONL 파일을 개발자나 Codex가 분석할 수 있게
  한다.
- 직접 식별자와 사용자 콘텐츠를 모든 build의 진단 journal에서 제외한다.
- 첫 구현은 device-local journal과 수동 export에 한정하고, 원격 수집은 나중에 별도
  동의와 정책을 갖춘 sink로 추가할 수 있게 한다.

## 비목표

- 1단계에서 Sentry 또는 다른 원격 수집기로 자동 upload하지 않는다.
- 진단 journal에 다이빙 profile, 수심·온도 sample, 위치, 사이트, 메모, 미디어,
  계획 내용이나 sync payload를 복제하지 않는다.
- Auth token, OAuth credential, 이메일, account ID, device name 또는 영구 device
  identifier를 어떤 build에서도 기록하지 않는다.
- 진단 기록 성공을 다이빙 저장, Watch import acknowledgement, account cloud sync,
  guest claim 성공 조건으로 사용하지 않는다.
- app-owned journal만으로 native crash를 완전하게 수집했다고 주장하지 않는다.
- 감압, 조직 loading, gas switching, 비상 판단 같은 safety-critical 기능을 추가하거나
  암시하지 않는다.

## 검토한 접근

### A. `console`과 `OSLog` 정리

변경량은 작지만 기기가 개발 환경에 연결되지 않은 시간의 기록 보존, Watch와 모바일
timeline 병합, 사용자 export, retention과 개인정보 필드 차단을 일관되게 제공하기
어렵다.

### B. 앱 소유 구조화 진단 파이프라인

공통 schema, 플랫폼별 순환 journal, Watch 전송, incident marker와 exporter를 앱이
소유한다. 1단계에는 local sink만 두고 나중에 같은 validated event를 받는 remote sink를
추가한다. 이 접근을 채택한다.

### C. 원격 수집 SDK 우선

모바일 crash reporting은 빠르게 얻을 수 있지만 Watch의 offline journal과 별도 통합이
필요하고, 초기 구현부터 외부 전송 동의·보존·삭제·sampling 정책을 함께 확정해야 한다.
원격 수집은 2단계로 미룬다.

## 공통 event contract

`packages/contracts`에 diagnostics JSON Schema를 source of truth로 추가하고 기존
generator를 통해 TypeScript와 Swift 타입을 만든다. 다이빙 session schema와 같은
package에서 관리하지만 diagnostics transport, queue와 ACK는 session sync와 공유하지
않는다.

Event는 다음 필드 계열만 갖는다.

- schema version, event ID, 발생 시각과 source-local sequence
- `mobile` 또는 `watch` source
- 앱 version/build, OS version, 일반 device model
- enum 기반 category, event name, severity와 error code
- boolean, count, duration, retry count와 connectivity state처럼 schema가 허용한 scalar
- app launch 또는 단일 operation 범위의 임시 correlation ID
- 누락된 journal write를 다음 정상 event에 알리는 bounded `droppedEventCount`

임의 문자열 metadata, 임의 object, 원본 `Error`, payload 전체를 받는 escape hatch는 두지
않는다. 알려지지 않은 오류는 raw `error.message`가 아니라 `unknown_failure`와 절대
경로·값을 제거한 normalized stack fingerprint로 표현한다. Runtime validator는 schema에
없는 key와 허용되지 않은 value를 journal write 전에 거부한다.

Timestamp와 일반 device model도 다른 정보와 결합되면 개인정보로 취급될 수 있다.
따라서 제품 설명은 이를 완전한 익명 데이터라고 부르지 않고, 직접 식별자와 사용자
콘텐츠를 제외한 최소화된 진단 데이터라고 정의한다.

## 구성 요소

### `DiagnosticRecorder`

Call site가 직접 journal format을 만들지 않게 하는 유일한 기록 entry point다. Typed
event input을 runtime에서 다시 검증하고 platform journal에 비동기로 전달한다. 진단
기록 실패를 throw해 본래 작업을 실패시키지 않는다.

### Mobile `DiagnosticJournal`

작은 segment로 나뉜 append-oriented 순환 저장소다. 전체 journal을 매 event마다 다시
쓰지 않는다. iPhone은 최근 14일 또는 10MB 중 먼저 도달한 한도를 적용하고 오래된
segment부터 원자적으로 제거한다.

### Watch `DiagnosticJournal`

Watch app-owned file 영역에 작은 JSONL segment로 저장한다. 최근 3일 또는 1MB 중 먼저
도달한 한도를 적용한다. Recording과 session persistence가 우선이며 diagnostics I/O가
그 경로를 block하지 않는다.

### 저장 보호

iOS와 watchOS journal은 app 전용 영역에 두고 backup에서 제외한다. 기기가 잠긴 뒤에도
필요한 background event를 기록할 수 있는 file protection을 선택한다. Android는 내부
`noBackupFilesDir`를 사용한다. 구체적인 native adapter 선택은 이 경계를 지켜야 하며
일반 document나 media directory에 저장하지 않는다.

### `WatchDiagnosticTransport`

Watch diagnostic batch를 독립된 WatchConnectivity file transfer로 iPhone에 전달한다.
Envelope에는 format version, batch ID, 생성 시각, event count와 checksum만 둔다.
Session body transfer, planned dive, deletion command, import ACK와 kind 및 durable queue를
공유하지 않는다.

### `IncidentMarker`

Settings의 진단 화면에서 사용자가 아래 고정 분류 중 하나를 선택한다.

- Watch 기록 문제
- 동기화 문제
- 로그인·계정 문제
- 화면 멈춤·종료
- 알림 문제
- 기타

자유 입력은 두지 않는다. Marker는 임시 incident ID를 생성하며 분석기는 marker 전
10분과 후 5분을 사건 구간으로 표시한다. 기존 event를 복제하거나 수정하지 않는다.

### `DiagnosticExporter`

Mobile journal snapshot과 이미 import된 Watch event를 발생 시각 순서로 합쳐 단일 JSONL
파일을 만든다. 첫 record는 schema version, export 생성 시각, 포함 기간, event count와
source별 count를 담은 manifest다. Export 실패나 공유 취소는 journal 원본을 바꾸지
않는다. App-owned 임시 export file은 공유 완료 뒤 또는 다음 app start에서 정리한다.

Settings의 진단 화면은 export 전에 포함 기간, event 수, file size와 포함되는 기기
정보 범주를 보여준다. 파일이 앱 밖으로 나가는 유일한 1단계 경로는 사용자가 시작한
share action이다.

### 향후 `RemoteDiagnosticSink`

Recorder와 journal의 validated event contract 뒤에 선택형 sink로 둔다. 2단계에서
provider를 비교한 뒤 추가하며, remote sink 실패는 local journal과 앱 동작에 영향을
주지 않는다. 사용자 동의, opt-out, privacy policy, retention/deletion, sampling과 rate
limit이 승인되기 전에는 활성화하지 않는다.

## 데이터 흐름

### 로컬 기록

1. App operation이 enum 기반 event를 `DiagnosticRecorder`에 전달한다.
2. Recorder가 schema allowlist를 검증한다.
3. Platform journal이 비동기로 append한다.
4. Storage가 바쁘거나 손상되면 event를 버리고 bounded drop count를 메모리에 남긴다.
5. 다음 정상 write가 drop count를 함께 기록한다.

진단 journal 손상은 해당 segment를 격리하거나 폐기하고 새 segment로 진행한다. Raw
bytes나 exception message를 별도 quarantine에 복제하지 않는다.

### Watch에서 iPhone으로 복사

1. Watch가 아직 ACK되지 않은 diagnostic event를 bounded batch로 만든다.
2. 별도 file transfer로 전송한다.
3. iPhone native inbox가 schema version과 checksum을 확인한다.
4. Mobile journal이 batch ID와 event ID로 idempotent import하고 readback한다.
5. 진단 전용 ACK를 durable outbox에 기록해 Watch에 보낸다.
6. Watch는 ACK된 batch만 pending set에서 제거한다.

Watch와 iPhone clock이 다를 수 있으므로 source-local sequence와 iPhone receive time을
함께 보존한다. 정렬은 occurred time을 사용하되 같은 source의 순서는 sequence로
안정화한다.

### 전체 삭제

사용자가 진단 화면에서 전체 삭제를 승인하면 iPhone journal과 export temp file을 즉시
지운다. Watch가 연결돼 있으면 purge-before command를 보내고, 연결돼 있지 않으면 요청을
durable하게 보관해 다음 연결에서 전달한다. Watch는 해당 시각 이전 journal과 pending
diagnostic batch를 지운 뒤 전용 ACK를 반환한다. Purge protocol도 session deletion 의미와
섞지 않는다.

## 초기 계측 범위

Mobile은 다음 결과와 상태 전환부터 계측한다.

- app launch/background/foreground와 previous run unfinished marker
- `AppErrorBoundary`와 normalized JavaScript failure
- Auth restore/login/logout의 상태와 정형 결과 코드
- account repository bootstrap, hydration, outbox reconciliation과 sync 결과
- guest claim phase와 정형 실패 코드
- WatchConnectivity activation, inbox import, local repository save와 ACK enqueue 결과
- notification permission, scheduling과 open routing 결과

Watch는 다음 결과와 상태 전환부터 계측한다.

- app launch와 runtime session lifecycle
- depth sensor availability/authorization 상태와 provider start/stop 결과
- recording state transition과 local session/profile save 결과
- planned dive receive/read 결과
- session transfer enqueue/ACK 결과
- diagnostics batch transfer/ACK/purge 결과

Navigation screen view, 사용자가 입력한 값, 실제 depth/temperature/pressure, dive duration,
site, plan과 session ID는 기록하지 않는다. `previous_run_unfinished`는 crash 확정이 아니라
정상 종료 marker가 관찰되지 않은 사실만 뜻한다.

## 오류와 앱 동작 경계

- Diagnostic write는 best effort이며 본래 operation transaction 안에 넣지 않는다.
- Watch local save가 성공했지만 diagnostic write가 실패해도 session save는 성공이다.
- Mobile local import가 성공했지만 diagnostic ACK가 실패해도 session import ACK 의미는
  바뀌지 않는다.
- Remote account sync와 guest claim 성공은 diagnostics 상태를 읽지 않는다.
- Export는 immutable snapshot을 사용하며 진행 중 write를 막지 않는다.
- Journal full, checksum mismatch, malformed batch, duplicated delivery, ACK loss와 purge retry는
  정형 결과로 처리하고 무한 재귀 logging을 막는다.

## 검증

자동 검증은 다음을 포함한다.

- JSON Schema generation과 TypeScript/Swift compile
- unknown key, arbitrary string/object와 금지 필드 거부
- token, email, account ID, location, note, dive sample canary가 journal/export에 남지 않는지
- normalized error가 absolute path와 raw message를 제거하는지
- 기간·용량 경계와 오래된 segment pruning
- truncated/corrupt segment recovery와 bounded drop count
- batch checksum 실패, duplicate/out-of-order delivery와 idempotent import
- ACK loss/retry와 session sync ACK 상태 독립성
- offline purge request와 reconnect resume
- incident window와 export manifest/count/order
- export failure/share cancel 뒤 journal 보존
- app start 시 stale export temp cleanup

관련 구현 뒤 가장 작은 gate부터 실행한다.

- `yarn check:quick`
- `yarn workspace @repo/mobile test`
- `yarn mobile:typecheck`
- `yarn watch:build`
- native bridge 변경 시 `yarn ios:build`
- architecture/wiki 변경을 포함한 handoff에서 `yarn codex:check`

실기기에서는 Watch background transfer, disconnect/reconnect, duplicate delivery, ACK retry,
3일/1MB pruning, iPhone 14일/10MB pruning, offline purge 전파와 exported JSONL 분석 가능성을
확인한다. Simulator나 build 성공을 paired hardware 검증으로 간주하지 않는다.

## 단계와 완료 기준

### 1단계: device-local diagnostics

공통 contract, 양쪽 journal, 초기 계측, Watch 자동 복사, incident marker, Settings 진단
화면, export와 purge를 구현하고 자동 검증 및 paired-device field test를 통과해야 한다.
이 단계 전에는 구조화된 통합 진단 기능이 구현됐다고 표현하지 않는다.

### 2단계: 동의 기반 원격 수집

실사용자 운영 전에 provider 선정, native crash/symbolication 범위, opt-in/opt-out,
privacy policy, sampling, retention, server deletion과 incident response를 별도 설계한다.
이 단계는 현재 승인된 architecture의 확장 지점일 뿐 아직 구현 승인이나 provider
선정이 완료된 상태가 아니다.

## Wiki 유지 경계

승인된 결정은 `.wiki/wiki/decisions/adr-privacy-minimized-diagnostics.md`에 기록한다.
구현 전에는 ADR과 열린 질문에서 planned 상태를 유지한다. 1단계 구현이 끝나면 code
source와 device evidence를 새 raw source로 추가해 현재 상태를 갱신하고, 2단계 항목은
remote collection이 실제 승인·검증될 때까지 완료로 옮기지 않는다.
