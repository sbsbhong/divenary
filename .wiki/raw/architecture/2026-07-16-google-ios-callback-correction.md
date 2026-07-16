Source URL: user correction, 2026-07-16; apps/mobile/.env.development; apps/mobile/ios/Divenary.xcodeproj/project.pbxproj; apps/mobile/__tests__/ios-auth-configuration.test.ts
Collected: 2026-07-16
Published: 2026-07-16

# Google iOS client and callback correction

사용자가 Google iOS Client ID가 main checkout에 있다고 정정했다. 확인 결과 ignored `apps/mobile/.env.development`의 `GOOGLE_IOS_CLIENT_ID`는 존재하고 Google iOS OAuth client 형식에 맞는다.

이전 검증은 별도 Git worktree에서 ignored development env가 복사되지 않는 특성을 로컬 값 자체의 부재로 잘못 해석했다. Worktree에서 파일이 보이지 않는 사실은 main checkout이나 provider console에 client가 없다는 증거가 아니다.

Client ID에서 표준 역순 URL scheme을 산출해 Divenary iPhone target의 Debug와 Release `GOOGLE_IOS_REVERSED_CLIENT_ID`에 동일하게 설정했다. `Divenary/Info.plist`는 이 build setting을 iPhone callback URL scheme으로 사용한다. DivenaryWatchApp target에는 Google callback setting이나 URL type을 추가하지 않았다.

이 변경은 native callback 구성을 준비하지만 physical Google login 성공을 증명하지 않는다. Hosted Supabase Google provider audience/secret, consent-screen test-user 상태와 실제 iPhone first/repeat/cancel login은 별도 physical Auth matrix에서 검증해야 한다.
