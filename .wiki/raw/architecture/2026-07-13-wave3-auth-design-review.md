Source URL: docs/superpowers/specs/2026-07-13-supabase-auth-cloud-sync-design.md; docs/superpowers/plans/2026-07-13-supabase-auth-foundation.md; https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically; https://supabase.com/docs/guides/auth/quickstarts/react-native; https://github.com/invertase/react-native-apple-authentication/tree/v2.5.1; https://react-native-google-signin.github.io/docs/original
Collected: 2026-07-13
Published: 2026-07-13

# Wave 3A Auth 설계 검토 보정

Status: accepted technical correction, implementation not started

- Membership row만으로 현재 필수 동의 완료를 판정하지 않는다. Immutable `legal_documents`, kind별 `current_legal_documents` pointer, append-only `consent_records`, `app_memberships`를 분리한다.
- `get_onboarding_status()`는 user id 인자 없이 현재 required set과 own consent coverage를 함께 반환한다. 새 current version이 배포되면 기존 membership도 재동의 전까지 incomplete다.
- `complete_onboarding(jsonb)`은 missing, extra, duplicate, stale, unknown, future-effective 요청을 거부하고 current terms/privacy exact set만 원자적으로 기록한다. 중복 호출은 기존 timestamp를 갱신하지 않는다.
- 2026년 Supabase Data API는 table grant를 자동 부여하지 않으므로 RLS와 별도로 최소 `GRANT`를 migration에 명시한다. Privileged RPC는 empty `search_path`, schema-qualified object, `auth.uid()`, anonymous-user denial, exact execute grant를 사용한다.
- React Native client는 `processLock`, Keychain storage, `autoRefreshToken: true`, foreground refresh lifecycle을 사용한다. `getClaims()`도 signing 방식/cache에 따라 network가 필요하므로 online claims/user/status 검증과 bounded offline fallback을 구분한다. Offline state는 마지막 server-verified cache와 unexpired stored session evidence가 일치할 때만 local-only로 허용한다.
- Current pointer는 future-effective document를 가리킬 수 없고, status/completion RPC는 current terms/privacy configuration이 정확히 유효한지 함께 검증한다. Consent write는 JWT `session_id`가 active `auth.sessions` row와 caller user에 일치해야 한다.
- Invertase Apple wrapper가 secure raw nonce를 만들고 hash를 Apple request에 넣는다. App은 성공 응답의 raw nonce를 Supabase에 전달하며 별도 random/hash code를 만들지 않는다. Google v16 cancellation은 error code가 아니라 discriminated response도 처리한다.
- Supabase URL/publishable key와 Google public client IDs만 bundle에 둘 수 있다. Provider secret과 `service_role`은 bundle에 넣지 않는다.
- Stable owned App ID, provider console 설정, signed provisioning, 실제 immutable legal URL, hosted test project, physical iPhone은 자동 구현과 분리된 promotion gate다. 3A는 in-app account deletion이 구현되는 3D 전까지 release 대상이 아니다.
- Guest claim은 많은 record/profile을 한 번에 처리하지 않고 persistent manifest와 bounded resumable batch를 사용한다.
