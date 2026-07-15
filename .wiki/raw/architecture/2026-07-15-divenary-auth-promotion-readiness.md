Source URL: docs/superpowers/plans/2026-07-13-supabase-auth-foundation.md; apps/mobile/ios/Divenary.xcodeproj/project.pbxproj; apps/mobile/ios/Divenary/Info.plist; local verification output
Collected: 2026-07-15
Published: 2026-07-15

# Divenary Auth promotion readiness evidence

Wave 3A의 자동 checkpoint를 Divenary rename 뒤 다시 검증했다. Local Supabase reset과 migration 적용이 성공했고 pgTAP 67개, REST Auth smoke test, database lint, security advisor, generated type drift check가 통과했다. `@repo/supabase` test 20개와 typecheck, mobile Jest 40 suite/418개와 typecheck도 통과했다.

실기기용 generic iOS Debug build를 automatic provisioning과 함께 실행했다. `com.divenary.app` iPhone app과 `com.divenary.app.watchkitapp` embedded Watch app이 Apple Development identity와 Xcode-managed provisioning profile로 서명됐고 embedded binary validation과 전체 build가 성공했다. 권한 있는 macOS trust context에서 두 app 모두 `codesign --verify --deep --strict`를 통과했다. Signed iPhone app에는 `com.apple.developer.applesignin = Default`가 있고 signed Watch app에는 Apple Sign In entitlement가 없다.

Local ignored `apps/mobile/.env.development`에는 Supabase URL, Supabase publishable key, Google web client ID가 존재하지만 Google iOS client ID는 없다. Checked-in iPhone build setting `GOOGLE_IOS_REVERSED_CLIENT_ID`도 빈 값이고 signed app의 callback URL scheme 역시 빈 문자열이다. 따라서 Google native login은 아직 physical test가 불가능하며 placeholder를 넣어 완료로 간주하지 않는다.

사용자는 Apple native Client ID `com.divenary.app`을 Supabase provider에 설정했다고 보고했다. 이 보고와 signed entitlement는 provider dashboard의 전체 설정, hosted migration/legal document, 실제 token audience 또는 physical login 성공을 대신하지 않는다. Google/Apple first/repeat/cancel, session restore/rejection, mandatory consent와 re-consent matrix는 physical iPhone에서 아직 실행되지 않았다.

사용자가 Auth 도입 전에 확인한 약 4분 foreground Watch pairing/import/local acknowledgement는 기준선으로만 유지한다. Identifier rename과 Auth 도입 뒤 guest Logbook/Planbook 보존 및 Watch import/acknowledgement regression은 아직 physical device에서 다시 확인해야 한다. 이 두 physical gate 전에는 Wave 3B를 시작하지 않으며, Wave 3A build는 앱 내 즉시 영구 계정 삭제를 추가하는 Wave 3D 전에는 release하지 않는다.
