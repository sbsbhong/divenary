Source URL: Codex conversation, 2026-08-02
Collected: 2026-08-02
Published: 2026-08-02

# 개인정보 최소화 모바일·Watch 진단 결정

사용자는 웹 개발과 달리 모바일·Watch 개발에서는 Codex가 화면과 runtime log를 즉시
확인하기 어렵고, field test에서 발생한 문제를 나중에 기억해서 설명하는 데 한계가
있다고 지적했다. 장기적으로 실제 사용자의 문제를 진단할 수 있는 로그 수집도 필요하다.

전체 구조는 장기 운영까지 확장 가능하게 설계하되 단계적으로 구현한다. 1단계는
device-local 구조화 로그와 사용자 수동 제출이며, 2단계 원격 수집은 별도 동의와 정책을
갖춘 후속 작업이다.

Debug와 Release를 구분해 다이빙 데이터를 기록하는 안은 검토했지만 철회했다. 모든
build의 진단 journal에서 개인정보와 다이빙 원본을 제외한다. 계정 식별자, 이메일,
Auth token, 위치, 사이트명, 메모, 미디어, 계획 내용, 수심·온도 sample과 전체 sync
payload를 저장하지 않는다. Event 종류, 정형 오류 코드, 처리 건수, 소요 시간, 재시도
횟수, 앱 상태와 연결 상태처럼 schema가 명시적으로 허용한 운영 정보만 기록한다.

Watch의 정제된 진단 로그는 연결될 때 iPhone으로 자동 복사한다. 이 복사는 cloud upload가
아니며 다이빙 session transfer 및 import ACK와 별도 queue·ACK를 사용한다. Watch는 최근
3일 또는 1MB, iPhone은 최근 14일 또는 10MB를 보존하고 먼저 도달한 경계에서 오래된
event부터 삭제한다. 사용자는 Settings에서 전체 진단 로그를 삭제할 수 있다.

Field test 중에는 자유 입력 없이 `Watch 기록 문제`, `동기화 문제`, `로그인·계정 문제`,
`화면 멈춤·종료`, `알림 문제`, `기타` 중 하나로 incident marker를 남긴다. Marker 전
10분과 후 5분을 하나의 분석 구간으로 취급한다.

채택한 구조는 앱 소유의 공통 diagnostic schema, Mobile/Watch 순환 journal,
Watch-to-iPhone diagnostic transport, incident marker, Settings 진단 화면, 단일 JSONL
exporter와 future remote sink 경계다. 첫 단계에서는 자동 원격 upload를 하지 않는다.
Sentry 같은 provider 선택, native crash reporting, 사용자 동의, opt-out, privacy policy,
sampling, server retention/deletion은 구현되지 않은 2단계 항목으로 남긴다.

승인된 상세 설계는
`docs/superpowers/specs/2026-08-02-privacy-minimized-diagnostics-design.md`에 기록한다.
