# Login Entry Redesign Design

## Goal

Divenary 홈의 로그인 진입점과 로그인 모달을 하나의 절제된 Apple-inspired 문법으로 다시 구성한다. 로그인 선택에 필요하지 않은 시각 요소는 제거하고, Google과 Apple 버튼은 같은 크기와 구조를 사용하되 각 공급자의 공식 식별 요소와 브랜드 규칙은 보존한다.

이 문서는 `2026-07-17-mobile-apple-polish-design.md`의 Home authentication entry와 Login sheet 결정을 대체한다. Splash와 서비스 전반의 copy policy는 기존 문서를 그대로 따른다.

## Current Problems

- 홈의 파란색 filled `InstrumentButton`은 화면 제목과 경쟁하며 시스템 내비게이션 액션보다 무겁게 보인다.
- Google과 Apple의 네이티브 버튼은 높이를 맞춰도 내부 폰트, 패딩, 배경과 모서리가 달라 하나의 화면에서 불균형하게 보인다.
- 최근 사용 공급자를 작은 overlay dot로 표시하면 의미가 명확하지 않고 버튼 위에 별도 장식이 얹힌다.
- `[0.62, 0.9]` detent와 `ScrollView`는 짧은 로그인 콘텐츠에 비해 빈 공간과 불필요한 확장 동작을 만든다.
- 로그인 선택과 직접 관계없는 로컬 기록 안내가 공급자 선택의 시각적 집중도를 낮춘다.

## Visual Direction

채택한 방향은 `Unified Neutral`이다.

- 홈은 파란색 텍스트 `로그인`만 표시한다.
- 로그인 화면은 콘텐츠 높이에 맞는 밝은 중립 form sheet다.
- D 마크, `Divenary 로그인` 제목, 닫기 버튼, 공급자 버튼, 오류 영역만 둔다.
- 두 공급자 버튼은 동일한 white surface, border, 54pt 높이, 8pt corner radius와 3-column geometry를 사용한다.
- 공급자 차이는 공식 아이콘과 공급자 이름에만 남긴다.

## Home Login Action

`RootNavigation`은 기존처럼 Auth 상태를 해석하고 `guest`일 때만 `showLogin`과 `onOpenLogin`을 `HomeScreen`에 전달한다. Home은 Auth context를 직접 구독하지 않는다.

홈 액션은 filled `InstrumentButton`에서 투명한 text `Pressable`로 변경한다.

- visible label: `로그인` / `Log in`
- visual color: Action Blue
- minimum hit target: width 52pt, height 44pt
- capsule, background, border와 icon: 없음
- authenticated, authenticated-offline, bootstrap, signing-in, onboarding 상태: 표시하지 않음

## Login Sheet Structure

`authLogin` route는 native `formSheet`를 유지하되 `sheetAllowedDetents`를 `fitToContents`로 변경한다. grabber와 28pt sheet corner radius는 유지한다.

`LoginScreen`은 짧은 고정 layout이므로 `ScrollView`를 제거한다. 내부 순서는 다음과 같다.

1. drag grabber는 navigation sheet가 제공한다.
2. 중앙 44pt D mark와 우측 44pt close control
3. `Divenary 로그인` 제목
4. ordered social provider buttons
5. 고정 높이 error/status row

guest Logbook/Planbook의 local-only 동작은 바꾸지 않지만 설명 문구는 로그인 시트에서 제거한다. 이 문구를 다른 화면으로 이동하는 작업은 이번 범위에 포함하지 않는다.

## Social Provider Button

공통 `SocialLoginButton`을 추가해 Google과 Apple에 같은 geometry를 적용한다.

- height: 54pt
- width: 100%
- corner radius: 8pt
- layout columns: 44pt icon / flexible centered title / 44pt status
- background: white in both light and dark mode
- border: provider branding rules를 만족하는 neutral stroke
- title: `Google로 계속` 또는 `Apple로 계속`

Google은 공식 multicolor G asset, Google이 허용한 localized continue title, light-theme stroke와 text color를 사용한다. Apple은 Apple Design Resources의 공식 black logo artwork, black title, 허용된 `Continue with Apple` title을 사용한다. 두 버튼은 light/dark sheet 모두 white surface를 사용하고 같은 크기와 visual weight를 가지며, 어느 공급자도 낮은 prominence로 표시하지 않는다.

Custom provider rows는 presentation만 대체한다. Google/Apple credential adapter, Supabase Auth repository, provider availability 판정과 `auth.signIn(provider)` 호출은 변경하지 않는다.

References:

- [Sign in with Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple)
- [Sign in with Google Branding Guidelines](https://developers.google.com/identity/branding-guidelines)

## Recent Provider

최근 사용 공급자 표시는 유지한다.

- 최근 공급자를 목록 첫 번째에 정렬한다.
- 모든 provider row는 항상 44pt status column을 예약한다.
- idle 상태에서 최근 공급자의 status column에 파란색 `최근` / `Recent` label을 표시한다.
- 다른 공급자의 status column은 빈 상태로 유지한다.
- 표시 유무에 따라 button width, title center, row height 또는 sheet height가 변하지 않는다.
- 접근성 label에는 `최근 사용` / `Recently used`를 포함한다.

최근 공급자 preference와 저장 시점은 기존 non-secret local preference 구현을 유지한다.

## Interaction And State Behavior

Provider ordering은 `availableProviders`의 복사본을 대상으로 수행하며 Auth state를 변경하지 않는다. `recentProvider`가 사용 가능한 공급자에 포함될 때만 첫 번째로 이동한다.

로그인 action이 시작되면 다음 규칙을 적용한다.

- 중복 요청을 막기 위해 모든 provider row와 close control을 disable한다.
- 선택한 row의 고정 status column에 spinner를 표시한다.
- 선택하지 않은 최근 공급자의 `최근` label은 유지할 수 있지만 위치와 크기는 변하지 않는다.
- 성공하면 기존 RootNavigation Auth-state effect가 sheet를 닫는다.
- 실패하면 raw provider error 대신 기존 localized retry message를 표시한다.

오류/status row는 항상 44pt 이상의 고정 공간을 차지하고 최대 두 줄의 localized error text를 수용한다. 오류가 없을 때는 빈 상태로 유지해 sheet 높이가 변하지 않게 한다. 오류가 표시되면 `alert` accessibility role을 사용한다.

공급자가 하나도 없으면 provider rows 대신 기존 unavailable title을 표시하고 close control은 유지한다. 이 상태에서도 sheet는 content-fit 높이를 사용한다.

## Accessibility

- Home login action은 44pt 이상의 hit target과 `button` role을 갖는다.
- Provider rows는 54pt hit target, provider-specific label과 disabled/busy state를 제공한다.
- 최근 공급자는 visible `최근` label과 screen-reader label 모두로 식별된다.
- decorative provider artwork는 중복 읽기를 막기 위해 accessibility tree에서 제외한다.
- accessibility reading order는 heading title, close control, ordered providers, error message 순서를 따른다. D mark는 decorative로 제외한다.
- light/dark surface와 text/border는 WCAG AA 수준의 contrast를 목표로 한다.

## Component Boundaries

- `RootNavigation`: guest-only visibility와 sheet presentation을 소유한다.
- `HomeScreen`: `showLogin`과 `onOpenLogin` props만 사용해 text action을 렌더링한다.
- `LoginScreen`: provider ordering, busy/error state와 sign-in orchestration을 소유한다.
- `SocialLoginButton`: provider presentation, fixed geometry, recent label과 spinner slot만 소유한다.
- existing Auth provider/repository: credential exchange, session persistence와 recent-provider storage를 계속 소유한다.

`SocialLoginButton`은 login screen에 한정된 component로 시작한다. 두 번째 call site가 생기기 전에는 shared UI package로 이동하지 않는다.

## Testing

### Home

- guest 상태에서 text login action을 표시하고 auth route를 연다.
- authenticated 및 authenticated-offline 상태에서는 action을 표시하지 않는다.
- action은 filled InstrumentButton styling 없이 44pt hit target을 유지한다.

### Login sheet

- route가 `formSheet`, `fitToContents`, grabber와 corner radius를 사용한다.
- login screen source에서 `ScrollView`와 guest-boundary copy를 제거한다.
- 두 provider row가 같은 54pt geometry와 fixed columns를 사용한다.
- official provider artwork와 allowed localized titles를 사용한다.

### Recent provider and state

- recent provider가 available providers 중 첫 번째로 정렬된다.
- recent label은 matching provider의 fixed status slot에만 표시된다.
- recent provider가 unavailable이면 순서나 label을 변경하지 않는다.
- selected provider만 인증 요청을 시작한다.
- busy state는 중복 요청과 close를 막고 selected row의 status slot에 spinner를 표시한다.
- error row는 visible error 유무와 관계없이 고정 높이를 유지한다.
- accessibility label, role, state와 minimum hit target을 검증한다.

## Out Of Scope

- Auth provider 구성, OAuth callback, Supabase session semantics 변경
- guest Logbook/Planbook claim, upload, delete 또는 partition
- 로그인 이후 onboarding 또는 Settings account 화면 재설계
- Splash와 다른 화면의 추가 copy audit
- 새로운 소셜 로그인 공급자 추가

## Success Criteria

- 홈에서 로그인 액션이 제목보다 강하게 보이지 않는다.
- Google과 Apple 버튼의 외곽 geometry와 typography hierarchy가 동일하게 느껴진다.
- 최근 사용 공급자를 즉시 확인할 수 있지만 어떤 상태 변화에서도 layout shift가 없다.
- 로그인 시트가 짧은 콘텐츠 높이에 맞고 불필요한 스크롤이나 빈 detent가 없다.
- 기존 Auth, recent-provider persistence와 local guest data 동작에 회귀가 없다.
