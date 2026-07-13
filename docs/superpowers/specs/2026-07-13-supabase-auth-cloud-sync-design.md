# Supabase Auth and Local-First Cloud Sync Design

## Context

`diving-app`은 guest local-only Logbook/Planbook과 Apple Watch import를 이미 갖고 있다. Watch에서 모바일로 가져온 세션은 iPhone local repository 저장이 끝난 뒤 acknowledgement되고, 이 상태는 Supabase cloud sync와 별개다. 사용자는 foreground 실기기에서 약 4분 세션의 pairing, 자동 import, local save 뒤 Watch `synced` 상태를 확인했다. Build identifier, 기기/OS, reconnect, background, killed-app, large-file 항목은 아직 완전한 물리 검증 증거가 아니다.

Wave 3은 Supabase와 Auth를 추가하되 기존 guest 데이터와 Watch 원본을 잃지 않고, 긴 1Hz profile을 목록 query에 싣지 않는 local-first cloud foundation을 만든다. 앱은 인증된 다이브 컴퓨터, 감압 컴퓨터, 의료기기, 비상 판단 시스템이 아니며 cloud 연결 여부도 수중 안전 판단과 무관하다.

## Goals

- iOS에서 native Google과 Apple 로그인을 제공한다.
- 로그인 없이 guest local-only 앱을 계속 사용할 수 있게 한다.
- 첫 social sign-in 뒤 필수 이용약관과 개인정보 문서 동의를 완료해야 앱 membership을 활성화한다.
- guest 데이터와 account 데이터를 로컬에서 분리하고, 명시적 동의 뒤에만 guest 데이터를 account에 연결한다.
- Logbook과 Planbook 원격 목록은 keyset cursor 기반 infinite pagination을 사용한다.
- 전체 1Hz profile은 private Supabase Storage의 immutable object로 저장하고 detail에서만 내려받는다.
- local outbox, retry/backoff, idempotency, optimistic revision conflict를 통해 offline-first sync를 제공한다.
- 로그아웃 시 해당 account의 local cache와 profile file을 제거하되 guest partition은 보존한다.
- 앱 안에서 즉시 영구 계정 삭제를 제공한다.

## Non-Goals

- Android native social login 구현. 공통 interface 호환만 유지하고 후속으로 둔다.
- 이메일/비밀번호, magic link, SMS Auth.
- 닉네임, avatar, 공개 profile, 친구 기능.
- 앱이 제공하는 manual identity linking/unlinking과 provider별 별도 user 강제. 같은 verified email의 OAuth identity는 Supabase Auth의 automatic linking 동작을 따른다.
- 마케팅 동의.
- 7일 유예 soft deletion과 account recovery. 후속 기능으로 기록한다.
- Realtime subscription, collaborative editing, CRDT 또는 field-level 자동 merge.
- Watch에 Supabase client, user id, cloud business logic을 넣는 것.
- 감압 의무, 조직 loading, gas switching 안전, 상승 허가, 비상 판단 계산.

## Delivery Strategy

Wave 3은 한 번에 구현하지 않고 독립적으로 검증 가능한 네 단계로 나눈다.

1. **3A Supabase/Auth foundation**: local Supabase, generated type, secure session, iOS native Google/Apple, membership과 필수 동의.
2. **3B Remote data foundation**: user-owned Logbook/Planbook schema와 RLS, keyset pagination, private profile Storage.
3. **3C Local-first sync**: guest/account partition, guest claim, outbox, cloud status, revision conflict, Watch ACK 분리.
4. **3D Account lifecycle**: logout purge, 즉시 영구 삭제, 통합 회귀와 실기기 검증.

각 단계는 자체 gate를 통과하기 전 다음 단계로 넘어가지 않는다. 같은 gate가 같은 원인으로 세 번 실패하면 중단하고 blocker를 보고한다.

## 3A: Supabase and Auth Foundation

### Repository Boundaries

- `supabase/`는 `config.toml`, migrations, seed, pgTAP tests를 소유한다.
- `packages/supabase`는 generated database type, client factory, Auth/membership repository를 소유한다. React Native UI와 provider-native SDK에 의존하지 않는다.
- `apps/mobile`은 Keychain session adapter, native Google/Apple credential adapter, Auth state provider, login/onboarding/Settings UI를 소유한다.
- iPhone target만 Sign in with Apple capability와 Google URL configuration을 갖는다. Watch target에는 Auth capability나 Supabase dependency를 추가하지 않는다.

### Auth State

```text
bootstrapping
  -> guest
  -> authenticating
  -> pendingOnboarding
  -> authenticated
  -> authenticatedOffline
```

- provider credential 성공만으로 membership이 활성화되지 않는다.
- session과 현재 필수 문서 동의를 모두 확인해야 `authenticated`가 된다.
- network failure는 invalid session과 구분한다. 마지막 membership을 알고 있으면 `authenticatedOffline`으로 local-only 사용을 허용한다.
- 명백한 token invalidation/revocation만 logout으로 처리한다.
- Supabase Auth listener는 process에서 한 번만 등록하고, foreground일 때 token refresh를 실행한다.

### Native Social Login

- Google native SDK의 ID token은 provider `google`로 직접 교환한다. 현재 선택한 무료 native SDK는 custom nonce를 provider request에 넣지 못하므로 검증되지 않는 nonce를 임의로 전달하지 않는다.
- Apple은 raw nonce를 생성하고 hashed nonce를 native request에 넣은 뒤 raw nonce와 ID token을 `supabase.auth.signInWithIdToken`으로 교환한다.
- browser OAuth, email/password, magic link는 사용하지 않는다.
- provider token은 Google/Apple API 사용 요구가 없으므로 저장하지 않는다.
- 앱은 manual linking/unlinking UI를 제공하지 않는다. 같은 verified email이면 Supabase Auth가 identity를 한 user에 automatic linking하는 기본 동작을 수용하며, app code가 email을 직접 비교하거나 병합하지 않는다.
- 마지막 성공 provider만 non-sensitive preference에 저장해 로그인 화면에 `최근 사용`으로 표시한다.

### Membership and Consent Schema

`app_memberships`:

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `onboarding_completed_at timestamptz not null`
- `created_at`, `updated_at`

`legal_documents`:

- `kind text` (`terms`, `privacy`만 v1에서 허용)
- `version text`
- `effective_at timestamptz`
- `document_url text`
- `required boolean`
- `(kind, version)` primary key

`consent_records`:

- `user_id uuid references auth.users(id) on delete cascade`
- `document_kind`, `document_version`
- `agreed_at timestamptz`
- `(user_id, document_kind, document_version)` primary key
- `legal_documents` composite foreign key

`complete_onboarding()` RPC는 owner id를 parameter로 받지 않고 `auth.uid()`를 사용한다. 호출 시점의 필수 문서를 다시 조회하고, 요청된 version이 현재 필수 version과 일치할 때 consent rows와 membership을 한 transaction에서 기록한다. 중복 호출은 동일 결과를 반환한다.

### Security

- `public` app table은 모두 RLS를 활성화한다.
- `app_memberships`와 `consent_records`는 owner만 읽을 수 있다.
- `legal_documents`는 공개 읽기만 허용하고 client write는 차단한다.
- onboarding RPC의 default `PUBLIC` execute는 revoke하고 `authenticated`만 호출한다.
- RPC는 fixed `search_path`, `auth.uid()` null check, current-version validation을 사용한다.
- authorization은 `user_metadata`나 provider email이 아니라 `auth.uid()`만 사용한다.
- mobile에는 project URL과 publishable key만 포함한다. provider secret과 `service_role`은 bundle에 넣지 않는다.
- Supabase session은 iOS Keychain storage adapter에 보관한다. token과 email은 log/analytics에 남기지 않는다.

### 3A Checkpoint Behavior

3A 완료 시 로그인과 membership은 작동하지만 Logbook/Planbook repository는 아직 현재 local-only 구현을 사용한다. 기존 guest data는 계속 보이고 `cloudSyncStatus`는 `notConfigured`다. Auth 실패나 onboarding 취소는 Watch import와 로컬 데이터에 영향을 주지 않는다.

## 3B: Remote Data Foundation

### Remote Models

`dive_logs`는 다음을 가진다.

- server `id uuid`, `user_id uuid`, client-generated `local_id text`
- list/filter용 `dive_mode`, `source`, `started_at`, `ended_at`, `duration_seconds`, `max_depth_meters`, `site_name`, `title`, `rating`
- versioned `manual_data jsonb`, `mobile_data jsonb`, `watch_metadata jsonb`, `provenance jsonb`
- bounded `profile_preview jsonb` (최대 160 sample)
- `profile_path`, `profile_content_revision`, `profile_sha256`, `profile_sample_count`
- `revision bigint`, `created_at`, `updated_at`, `deleted_at`
- `(user_id, local_id)` unique constraint

`dive_plans`는 server id와 owner/client id, list용 `status`, `planned_at`, `dive_mode`, `site_name`, versioned `plan_data jsonb`, `revision`, timestamps, tombstone을 가진다.

JSONB는 domain payload 진화를 수용하고, 목록·정렬·filter에 필요한 값만 typed column으로 중복한다. Mobile code는 직접 SQL을 사용하지 않고 generated type과 repository function을 통해 접근한다.

### Pagination

- Logbook 기본 page size는 30이다.
- Logbook cursor는 `(started_at desc, id desc)`, Planbook cursor는 `(planned_at desc, id desc)` keyset tuple이다.
- offset pagination은 사용하지 않는다.
- 검색/filter가 바뀌면 query key와 cursor를 새로 시작한다.
- React Query `useInfiniteQuery`가 page 단위 loading/error/retry를 관리한다.
- 목록 응답에는 full profile sample이나 Storage signed URL을 포함하지 않는다.

### Profile Storage

- private bucket 이름은 `dive-profiles`다.
- object path는 `<user_id>/<dive_log_id>/<content_revision>.json`이다.
- artifact는 immutable create-only이며 overwrite하지 않는다.
- Storage RLS는 path 첫 segment가 `auth.uid()`와 같은 owner만 insert/select/delete하게 한다.
- detail을 열 때만 profile을 내려받아 account-scoped local file cache에 둔다.
- digest와 byte/sample count를 검증한 뒤 UI에 제공한다.

## 3C: Local-First Sync

### Principal Partitions

로컬 저장소는 `guest`와 `user:<uuid>` namespace로 분리한다.

- guest 상태 Watch import와 manual write는 guest partition에 저장한다.
- authenticated 상태 local write는 current user partition에 먼저 저장하고 outbox에 enqueue한다.
- 다른 user partition이나 guest partition은 현재 Logbook/Planbook에 섞지 않는다.
- 기존 unscoped AsyncStorage data는 한 번만 guest partition으로 migration한다.

### Guest Claim

첫 cloud 연결 때 guest record count와 범위를 보여주고 명시적 동의를 받는다.

1. guest snapshot과 profile digest를 고정한다.
2. current account partition으로 copy한다.
3. owner id와 outbox operation을 생성한다.
4. remote metadata와 profile upload를 검증한다.
5. 모든 record가 account local/remote에 존재하는 것을 확인한 뒤 guest source를 제거한다.

중간 실패 시 guest source를 보존하고 같은 operation id로 재시도한다. 동의하지 않으면 account session을 종료하고 guest로 돌아간다.

### Outbox and Cloud Status

Outbox item은 operation id, principal, entity kind/id, mutation type, payload snapshot, expected revision, profile reference, attempt count, next retry time을 가진다.

- local save 성공이 UI 성공 조건이다.
- `cloudSyncStatus`는 backend 활성화 뒤 `pending | synced | failed | conflict`를 사용한다.
- exponential backoff와 jitter를 사용하고 app launch/foreground/network recovery/manual retry에서 drain한다.
- 같은 operation id와 `(user_id, local_id)` upsert는 idempotent하다.
- Watch `session.syncStatus: synced`는 iPhone local import ACK만 뜻하며 remote outbox 결과를 기다리지 않는다.

### Conflict

- remote row는 `revision bigint`를 사용한다.
- update/delete는 client가 마지막으로 본 expected revision과 일치할 때만 성공한다.
- mismatch이면 remote latest를 가져오고 local mutation을 `conflict`로 보존한다.
- v1은 last-write-wins, field merge, CRDT를 사용하지 않는다.
- conflict resolution UI는 local 또는 remote 중 하나를 명시적으로 선택해 새 revision mutation을 만드는 방식이다.

## 3D: Account Lifecycle

### Logout

- server sign-out/revocation을 요청한다.
- network 실패 여부와 관계없이 Keychain session, current account React Query cache, account partition, downloaded profile files를 제거한다.
- guest partition은 보존한다.
- 다른 account cache를 표시하지 않는다.

### Immediate Permanent Deletion

- Settings 안에서 삭제 범위와 복구 불가를 표시하고 재확인을 받는다.
- privileged server boundary가 caller JWT를 검증하고 session을 revoke한 뒤 Storage object, user-owned database row, Auth user를 idempotent하게 삭제한다.
- `service_role`은 server 환경에만 둔다.
- 성공 후 mobile account cache와 credentials를 제거하고 guest로 돌아간다.
- 7일 유예 soft deletion과 복구는 후속 기능으로 기록한다.

## Error Handling

- network error는 local write나 guest data를 rollback하지 않는다.
- repository/profile upload failure는 outbox를 남긴다.
- corrupted profile은 remote metadata에 연결하거나 synced로 표시하지 않는다.
- guest claim은 copy-and-verify가 끝나기 전 source를 삭제하지 않는다.
- logout은 local privacy purge를 server response보다 우선한다.
- account deletion 부분 실패는 같은 deletion request가 안전하게 재시도될 수 있어야 한다.
- invalid/revoked session과 temporary network failure를 별도 error type으로 다룬다.

## Testing Strategy

### Automated

- migration reset과 generated type drift.
- RLS owner isolation, anonymous denial, consent append-only, onboarding RPC current-version/idempotency.
- secure session adapter and Auth state transitions including offline recovery.
- native provider cancellation, Google token exchange, Apple nonce/token exchange adapter boundaries.
- guest/account namespace migration and cross-account visibility denial.
- cursor pagination ordering/no-duplicate behavior.
- Storage path owner policies, immutable upload, digest verification.
- outbox retry/idempotency, Watch ACK independence, expected-revision conflict.
- logout cache/profile purge and account deletion authorization.

### Manual and Physical

- iOS native Google and Apple first login, repeat login, cancel, revoked credential, app restart.
- required consent completion and changed document re-consent.
- guest data claim with offline interruption and retry.
- long profile upload/download and infinite list scrolling.
- logout shared-device privacy and immediate account deletion.
- 기존 foreground Watch pairing/import/local ACK regression.
- reconnect, background/killed, planned dive, 8,000-sample transfer는 여전히 별도 Wave 1 physical gate다.

## Success Criteria

- Guest can use local Logbook/Planbook without an account.
- iOS Google/Apple native login restores securely and requires current mandatory consent.
- One user cannot read or mutate another user's rows or Storage objects.
- Lists never fetch full 1Hz profiles and remain cursor-paginated.
- Watch local ACK never waits for Supabase.
- Guest claim, outbox, conflict, logout, deletion paths do not silently lose local data.
- No cloud success UI appears before remote persistence is verified.
- Android native Auth and 7-day soft deletion remain explicitly deferred.

## References

- [Supabase React Native Auth](https://supabase.com/docs/guides/auth/quickstarts/react-native)
- [Supabase Login with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Supabase Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase ID Token Sign-In](https://supabase.com/docs/reference/javascript/auth-signinwithidtoken)
- [Supabase Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase Local Development](https://supabase.com/docs/guides/local-development/overview)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- `.wiki/wiki/architecture/profile-file-sync.md`
- `.wiki/wiki/architecture/supabase.md`
- `.wiki/wiki/architecture/mobile-logbook-roadmap.md`
