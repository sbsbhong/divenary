# ADR 목록

Sources: pre-Karpathy wiki page, 2026-06-28; Diving App accepted design and implementation, 2026-07-12; 사용자 승인 진단 설계, 2026-08-02
Raw: [Pre-Karpathy: ADR 목록](../../raw/decisions/adr-index.md); [개인정보 최소화 모바일·Watch 진단 결정](../../raw/decisions/2026-08-02-privacy-minimized-diagnostics.md)
Updated: 2026-08-02

## 요약

이 문서는 accepted architecture decision record 목록을 관리한다.

## 현재 상태

- [ADR: Local-first mobile logbook with future Supabase sync](adr-local-first-mobile-logbook.md): 모바일 로그북을 local-first로 구현하고, 이후 Supabase sync를 같은 저장소 경계 위에 붙이는 결정을 기록한다.
- [ADR: 1Hz immutable profile과 file-only session sync](adr-one-hertz-file-sync.md): raw live callback과 bounded profile을 분리하고 session body를 immutable file 하나로 전달하는 결정을 기록한다.
- [ADR: 개인정보 최소화 device-local 진단 파이프라인](adr-privacy-minimized-diagnostics.md): 모든 build에서 사용자 콘텐츠를 제외하고 Mobile/Watch local journal, 전용 전송·ACK, incident marker와 수동 export를 먼저 구현한 뒤 원격 수집을 별도 동의 단계로 추가하는 결정을 기록한다.

## 상세

Repository instruction, README note, product planning doc에는 작업 지침과 현재 프로젝트 맥락이 있다. 명시적으로 accepted decision이 생기고 architecture decision으로 보존할 필요가 있을 때만 별도 ADR page를 추가한다.

## 관련 문서

- [프로젝트 개요](../project/overview.md)
- [Monorepo 구조](../architecture/monorepo.md)
- [모바일 로그북 로드맵](../architecture/mobile-logbook-roadmap.md)
- [열린 질문](../questions/open-questions.md)
