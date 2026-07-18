Source URL: `apps/mobile/scripts/load-mobile-env.js`; `apps/mobile/src/config/env.ts`; `apps/mobile/src/auth/create-mobile-auth.ts`; `supabase/scripts/staging-project.mjs`; `supabase/scripts/verify-staging-auth.mjs`
Collected: 2026-07-18
Published: 2026-07-18

# Staging/local Auth fail-closed 보정

Status: implemented and automatically verified

- 이전 staging/local Auth 증거 원본의 `supabase/scripts/staging-auth.mjs` 표기는 잘못됐다. 실제 staging 구현은 `staging-project.mjs`와 `verify-staging-auth.mjs`에 있다.
- Development build의 `MOBILE_ENVIRONMENT`는 비어 있으면 staging을 기본값으로 사용하고, `local`, `staging`, `release`만 명시적으로 허용한다. 다른 값은 build configuration 오류로 중단한다.
- Local mode는 HTTP loopback endpoint와 생성된 email/password가 모두 있어야 Auth client를 만든다.
- Staging mode는 `https://mclvhwzsuvsxjerdouka.supabase.co` origin만 허용한다. Local 또는 다른 hosted project URL이면 Auth client를 만들지 않는다.
- Release mode는 development Auth 값을 사용하지 않으며 Auth client를 만들지 않는다. Production backend는 별도 검토된 configuration 경로가 필요하다.
