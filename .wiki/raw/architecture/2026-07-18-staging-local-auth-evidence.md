Source URL: `apps/mobile/scripts/load-mobile-env.js`; `apps/mobile/scripts/create-metro-environment-config.js`; `apps/mobile/src/auth/`; `supabase/scripts/local-mobile-auth-fixture.mjs`; `supabase/scripts/staging-auth.mjs`; `README.md`
Collected: 2026-07-18
Published: 2026-07-18

# Staging/local Auth 개발 경계와 승격 증거

Status: local development hardening complete; signed physical Auth promotion pending

## 명시적 mobile 환경 경계

- Mobile bundle에는 normalized `local`, `staging`, `release` mode를 명시적으로 inline한다. Development와 Jest test만 development/local file loading을 allowlist하고, unknown 또는 non-development Babel environment는 ignored development/local file과 process environment의 mobile configuration을 bundle에 넣지 않는다.
- Password login은 mode가 `local`이고 `__DEV__`가 true이며 Supabase endpoint가 `localhost`, `127.0.0.1`, `10.0.2.2` 중 하나이고 fixture email/password가 모두 있을 때만 구성된다.
- Explicit local mode는 fixture가 없거나 잘못됐거나 shell process environment가 remote Supabase URL을 주입해도 Google/Apple adapter와 button을 구성하지 않는다. Staging mode만 native social Auth를 구성한다.
- Google/Apple/password sign-in의 outward error는 raw cause와 token, nonce, email, password를 보존하지 않는다. 호출자가 분기할 수 있는 operation, allowlisted code, integer status만 유지한다.

## Local fixture와 Metro 경계

- 일상적인 authenticated 개발은 실제 Docker local Supabase에서 `yarn supabase:start` 또는 `yarn supabase:reset`, `yarn mobile:auth:local:prepare`, `yarn mobile:ios:local` 또는 `yarn mobile:android:local` 순서로 수행한다. Local Metro는 staging 기본 port와 분리된 `8082`를 사용한다.
- Metro cache identity에는 fully selected inline environment와 explicit mode를 SHA-256으로 fingerprint한 non-secret cache version을 넣는다. Cache identity나 command output에는 password 원문을 넣지 않는다.
- Fixture prepare는 `127.0.0.1:8082`를 exclusive하게 선점한 뒤에만 credential을 rotate한다. Port를 local Metro가 소유하면 fail closed하고 기존 process를 종료하지 않는다. 따라서 실행 중인 local Metro가 이전 password를 보유한 상태에서 fixture만 rotate할 수 없다.
- Ignored `apps/mobile/.env.local`은 mode `0600`으로 생성한다. Exclusive `wx`로 process-owned temp file을 만든 뒤 rename하며, write/rename 실패 때는 이 process가 생성한 temp file만 정리한다. Exclusive create가 실패하면 기존 stale 또는 attacker-created path를 삭제하지 않고 final file도 덮어쓰지 않는다.

## Hosted staging 증거

- Hosted project `mclvhwzsuvsxjerdouka`는 staging 전용이고 production project가 아니다. Migration `20260713135707`이 적용됐으며 current terms/privacy는 `2026-07-18-staging.1`, `2026-07-18T00:00:00.000Z`이고 promotion commit에 고정된 immutable HTTPS URL을 사용한다.
- Guarded staging command는 project ref가 정확히 `mclvhwzsuvsxjerdouka`일 때만 link, migration list, push, legal seed, verification을 수행한다. Verifier는 deployed legal URL에서 promotion SHA를 추론하므로 이후 repository commit과 무관하게 deployed promotion을 확인한다.
- 같은 promotion commit에서 seed를 다시 실행하는 것은 idempotent하다. 이후 commit을 새 promotion으로 seed하려면 먼저 새 legal version과 그 version의 immutable URL을 정의해야 한다. 기존 immutable version의 URL을 현재 `HEAD`로 바꾸지 않는다.
- Hosted verifier는 exact legal rows/effective time/immutable URLs, `get_onboarding_status() -> jsonb` metadata, anonymous `42501` denial, Google/Apple enabled flag를 통과했다. Hosted staging 앱은 실제 provider callback용 `apps/mobile/.env.development`를 쓰며 local password fixture와 섞지 않는다.

## 남은 물리 gate와 제품 경계

- Google/Apple native token exchange, cancellation/repeat, signed callback, session restore, re-consent는 signed physical device에서 수동으로 검증해야 한다. Verifier 또는 provider enabled flag만으로 통과했다고 주장하지 않는다.
- Guest Logbook/Planbook은 계속 local-only이며 cloud sync나 account claim은 추가하지 않았다.
- 이 앱은 다이빙 기록과 사후 리뷰 도구다. 인증된 다이브 컴퓨터, 의료기기 또는 생명-critical 판단 시스템이 아니다.
