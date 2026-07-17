# Mobile Apple Polish Design

## Goal

Divenary의 첫 인상과 인증 진입을 iOS와 Android에서 하나의 절제된 Apple-inspired 경험으로 맞추고, 화면에 반복되는 설명을 기능 수행에 필요한 문구만 남기도록 정리한다.

## Decisions

### Splash

두 플랫폼의 네이티브 launch surface를 동일한 구성으로 맞춘다. 밝은 모드에서는 parchment `#F5F5F7`, 어두운 모드에서는 black `#000000`을 사용하고, 중앙에는 Action Blue 원 안의 흰색 `D` 마크 하나만 둔다. 제품명, 로딩 문구, 프레임워크 표기, 인위적인 지연과 JavaScript 애니메이션은 넣지 않는다.

iOS는 `LaunchScreen.storyboard`와 asset catalog의 단일 SVG image set을 사용한다. Android 24-30은 window background layer-list, Android 31 이상은 platform splash attributes를 사용한다. Android vector와 iOS SVG는 같은 96x96 geometry를 공유한다.

### Home authentication entry

홈 상단은 `Divenary` 제목과 우측 로그인 CTA만 남긴다. 언어 전환은 설정 화면에만 유지한다. `RootNavigation`이 인증 상태를 해석해 `guest`일 때만 로그인 버튼을 노출하고, 로그인 중·부트스트랩·동의 대기·로그인·오프라인 로그인 상태에서는 숨긴다. 홈 화면은 Auth context를 직접 구독하지 않고 `showLogin`과 `onOpenLogin` props만 받는다.

### Login sheet

로그인 route는 native `formSheet`로 표시하고 grabber와 고정 corner radius를 사용한다. Android에서도 React Native Screens의 Material sheet presentation을 사용한다.

화면은 제목, 닫기 아이콘, 공급자 버튼, 짧은 로컬 기록 보존 문구, 오류 상태만 갖는다. Google과 Apple은 각 공급자의 네이티브 버튼을 유지하되 둘 다 light surface, 같은 52pt 높이, 같은 폭과 8pt corner grammar로 맞춘다. 최근 사용 공급자는 별도 텍스트 행을 추가하지 않고 버튼 우측 상단의 작은 blue dot로 표시한다. dot에는 `최근 사용` 접근성 라벨을 제공한다.

### Copy policy

화면 문구는 다음 네 범주만 유지한다.

1. 사용자가 누르거나 선택하는 action/label
2. 오류, 권한, 비어 있음처럼 다음 행동을 결정하는 상태
3. 이용약관 및 개인정보 처리방침 동의
4. 다이빙 안전 경계를 오해하지 않게 하는 화면당 하나의 safety statement와 unsupported-depth 같은 값별 경고

제목을 반복하는 subtitle, 상태 pill과 본문이 같은 의미를 반복하는 문구, 개발 단계 placeholder/future workflow, 성공·오류 문구 뒤의 당연한 설명, 중복 safety card는 제거한다. Home, Login, Onboarding, Logbook, Planning, Memory, Settings를 같은 기준으로 감사한다. 안전 경계와 legal text는 축약 대상에서 제외한다.

## Alternatives considered

### Keep native splash and only restyle React Native screens

구현 범위가 작지만 Android 12 splash와 iOS launch screen이 서로 달라 첫 인상이 해결되지 않는다.

### Replace provider controls with fully custom buttons

가장 쉽게 시각적으로 통일할 수 있지만 Apple과 Google의 인증 버튼 표현 규정을 벗어날 수 있다.

### Shared native-first visual grammar

채택안이다. 네이티브 splash와 공급자 컨트롤을 유지하면서 surface, 크기, 간격, modal presentation을 통일해 플랫폼 신뢰성과 디자인 일관성을 함께 보존한다.

## Error and state behavior

- 공급자가 구성되지 않았으면 짧은 unavailable title만 표시하고 닫기 동작을 유지한다.
- 인증 실패는 raw error를 노출하지 않고 기존 retry copy를 유지한다.
- 로그인 action 중에는 두 공급자 버튼과 닫기 동작을 잠근다.
- recent-provider preference는 기존 non-secret local store를 그대로 사용한다.
- 로그인은 guest Logbook/Planbook을 upload, delete, claim 또는 partition하지 않는다.

## Testing

- Native splash source test로 iOS/Android가 같은 배경·마크를 사용하고 framework 문구가 제거됐는지 확인한다.
- App navigation test로 guest CTA 노출, 언어 메뉴 제거, login route 연결, authenticated 상태 숨김을 확인한다.
- Auth screen test로 공급자 버튼 geometry, light styling, recent dot의 overlay/accessibility를 확인한다.
- Copy audit test로 삭제 대상으로 확정한 subtitle, 중복 reminder card, placeholder workflow가 화면 source에 다시 들어오지 않게 한다.
- `yarn mobile:typecheck`, mobile Jest, `yarn ios:build`를 최종 gate로 실행한다.

## Self-review

- Placeholder: 없음.
- Consistency: 네이티브 splash와 login sheet 모두 parchment/black surface와 Action Blue를 사용한다.
- Scope: mobile UI와 mobile native launch resource에 한정한다.
- Ambiguity: “최근 사용”은 보이는 텍스트가 아니라 접근성 있는 blue dot로 명시했다.
