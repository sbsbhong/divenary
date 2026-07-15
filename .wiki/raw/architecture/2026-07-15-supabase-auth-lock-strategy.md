Source URL: installed `@supabase/auth-js@2.110.2` source (`src/GoTrueClient.ts`, `src/lib/locks.ts`, `src/lib/types.ts`)
Collected: 2026-07-15
Published: 2026-07-15

# Supabase Auth 2.110.2 lock strategy correction

Status: accepted implementation correction

- `auth.lock`와 `processLock`은 설치된 `@supabase/auth-js@2.110.2`에서 deprecated이며 v3 제거 예정이다.
- 새 React Native client는 custom `lock`을 전달하지 않고 SDK 기본 lockless single-flight와 commit guard를 사용한다.
- Session persistence, foreground lifecycle 의미는 유지한다. Client는 Keychain-compatible storage, `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false`, `throwOnError: false`를 사용한다.
- AppState가 active일 때 `startAutoRefresh()`, background/inactive일 때 `stopAutoRefresh()`를 호출하는 책임은 mobile Auth provider에 남는다.
- 이 보정은 session 신뢰 정책을 바꾸지 않는다. 복원 session은 `getClaims()`와 `getUser()`로 검증하며 network failure와 invalid token을 구분하고, bounded offline fallback은 마지막 server-verified cache와 아직 만료되지 않은 stored evidence가 정확히 일치할 때만 허용한다.
- 로컬 Supabase CLI는 shell에 주입된 다른 hosted project의 `SUPABASE_PROJECT_ID`/access token을 상속하지 않는다. 전용 local wrapper가 해당 환경 변수를 제거한 뒤 repository `config.toml`의 `project_id`로만 start/reset/test/lint/advisor 명령을 실행한다.
- Raw `yarn supabase`는 향후 명시적인 hosted promotion 용도로 남기고, local migration/type generation/REST harness는 모두 격리된 환경을 사용한다.
