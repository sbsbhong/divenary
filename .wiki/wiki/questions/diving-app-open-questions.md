# Diving App / Open Questions

Sources: user pasted request, 2026-06-28; user pasted hardening request, 2026-06-28; user requested v1 Air-only safety stop scope, 2026-06-28; Diving App repository implementation, 2026-07-05; Diving App repository implementation, 2026-07-07; user requested depth/safety stop/deco pending work, 2026-07-08; pre-device depth safety sync readiness implementation, 2026-07-09
Raw: [Diving app technical wiki request](../../raw/algorithms/2026-06-28-diving-app-technical-wiki-request.md); [Diving app wiki hardening request](../../raw/algorithms/2026-06-28-diving-app-wiki-hardening-request.md); [v1 Air-only scuba safety stop scope](../../raw/project/2026-06-28-v1-air-only-scuba-safety-stop.md); [Watch freedive segments and scuba safety stop implementation](../../raw/architecture/2026-07-05-watch-freedive-safety-stop-implementation.md); [Watch real-device readiness and explicit demo mode](../../raw/architecture/2026-07-05-watch-real-device-readiness.md); [Watch debug demo sync logbook UX](../../raw/architecture/2026-07-07-watch-debug-demo-sync-logbook-ux.md); [Depth cap, safety stop color, decompression stop terminology pending work](../../raw/questions/2026-07-08-depth-safety-stop-deco-pending-work.md); [Pre-device depth safety sync readiness](../../raw/decisions/2026-07-09-pre-device-depth-safety-sync-readiness.md)
Updated: 2026-07-09
Status: Draft / Needs Validation
Owner: local product/dev agent
Last reviewed: 2026-07-09
Change policy: open questions can be updated when decisions have source-backed rationale
Related pages: [Diving App / Immutable Algorithm Reference](../algorithms/diving-app-algorithm-reference.md); [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md); [Diving App / Product Roadmap](../project/diving-app-product-roadmap.md)
Slug: diving-app-open-questions

## 요약

이 문서는 Apple Watch Ultra급 프리다이빙/스쿠버 제품 방향에서 아직 결정해야 할 질문을 저장한다. v1 Air-only safety stop reminder의 기본 trigger/countdown/reset/copy, `CMWaterSubmersionManager` 기반 real sensor provider, 40m 초과 값 보존+unsupported warning 정책, v1 recommendation-only safety stop metadata는 implementation에 들어갔다. 실제 underwater sensor behavior, auto-launch, store-level Ultra-only filtering, 사용자 설정 정책, long-term safety stop field migration, decompression stop 용어와 data model은 아직 검증하거나 설계해야 한다.

## 질문

1. v2에서 기본 Gradient Factor 값을 무엇으로 둘 것인가? 예: GF 40/85, 45/85, 50/80 등. 제품 보수성 정책이 필요하다.
2. v2를 Air+Nitrox no-decompression mode로 시작할지, Nitrox만 v2의 차별 기능으로 둘지? v1은 Air-only safety stop까지 포함한다.
3. Apple Watch Ultra의 depth sensor sampling rate, auto-launch prompt, background execution behavior를 실제 기기에서 어떻게 검증할지?
4. 수심 센서값 이상치 제거 필터와 temperature fallback 정책을 어떤 방식으로 구현할지?
5. v1 Air-only safety stop 기본값은 10m arm threshold, 5m/180초 target, 3-6m displayed zone, 2.7-6.3m counting zone, counting zone 밖 연속 30초 reset으로 구현됐다. Too-deep 상태는 전용 safety-stop UI 대신 일반 scuba live instrument로 돌아간다. 이 값을 사용자 설정이나 plan override로 얼마나 열지, 실제 센서 노이즈에서 pause/resume/reset과 이탈 marker가 충분히 안정적인지는 실기기 검증 뒤 결정해야 한다.
6. CNS table은 NOAA 원표 기반으로 내장할지, 검증된 라이브러리 기반으로 둘지?
7. Bühlmann ZHL-16C coefficients는 어떤 canonical source에서 고정할지?
8. v2에서 mandatory deco 상황 발생 시 계속 계산할지, `deco obligation 발생 / 즉시 보수 절차` 중심으로 제한할지?
9. 무선 탱크 압력 송신기 지원 가능성은 어떤 하드웨어/프로토콜에 의존하는지?
10. 로그 export format은 UDDF, Subsurface-compatible format, CSV, JSON 중 무엇을 지원할지?
11. 40m 초과 unsupported-depth warning이 실제 수중 watch 화면에서 충분히 눈에 띄지만 과도한 지시처럼 보이지 않는지?
12. v1 safety stop의 `safetyStop.required` compatibility field를 장기적으로 rename/migrate할지, 아니면 future mandatory/decompression entity만 별도로 추가할지?
13. future mandatory/decompression stop 색상과 severity를 v1 recommendation-only safety stop과 어떻게 분리할지?
14. Decompression stop을 추가할 때 safety stop과 별도 entity로 둘지, 외부 dive computer import의 사실 기록으로만 저장할지, 앱이 직접 계산하는 고위험 기능으로 둘지?

## 검증 TODO

- canonical ZHL-16C N2/He half-time, `a`, `b` coefficient table source 확정.
- coefficient table을 코드 상수로 고정하기 전 독립 출처 2개 이상과 대조.
- Subsurface, Shearwater 문서, Bühlmann 원자료 또는 검증된 오픈소스 구현과 비교.
- coefficient 변경 시 기존 dive state와 regression test에 미치는 영향 문서화.
- GF 기본값 정책 확정 전 제품 보수성 검토.

## 관련 문서

- [Diving App / Product Roadmap](../project/diving-app-product-roadmap.md)
- [Diving App / Immutable Algorithm Reference](../algorithms/diving-app-algorithm-reference.md)
- [Diving App / QA and Test Plan](../project/diving-app-qa-test-plan.md)
- [Diving App / State Management](../architecture/diving-app-state-management.md)
- [열린 질문](open-questions.md)
