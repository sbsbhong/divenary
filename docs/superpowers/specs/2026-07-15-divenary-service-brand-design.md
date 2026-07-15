# Divenary Service Brand Design

## Decision

서비스와 앱의 공식 영문 이름은 `Divenary`로 한다. 한국어로 이름을 설명해야 할 때는 `다이브너리`로 표기하지만, 앱 아이콘, App Store, 로그인 공급자 동의 화면과 제품 UI의 기본 wordmark는 번역하지 않은 `Divenary`를 사용한다.

`Divenary`는 `Dive`와 `Diary`/`Dictionary`를 결합한 이름이다. 사용자가 다이빙 경험을 기록하고, 계획과 로그를 축적하고, 지난 다이빙을 다시 꺼내 보는 개인 기록 공간이라는 제품 의미를 담는다.

## Product Positioning

- 핵심 약속: `Every dive, remembered.`
- 설명용 제품 문구: `Dive log & Apple Watch companion`
- 한국어 설명: `다이빙 계획과 기록을 쌓고 다시 돌아보는 개인 로그북`
- 브랜드 성격: 차분함, 신뢰감, 개인적인 기억, 글로벌 서비스

`Divenary`는 인증된 다이브 컴퓨터, 감압 컴퓨터, 의료기기, 생명 유지 장치 또는 비상 판단 시스템으로 설명하지 않는다. 브랜드와 스토어 문구는 기록, 사후 회고, 비중요 계획 리마인더와 Apple Watch 캡처 동기화에 한정한다.

## Naming System

| Surface | Approved name |
| --- | --- |
| 서비스 브랜드 | `Divenary` |
| iPhone 앱 표시 이름 | `Divenary` |
| Apple Watch 앱 표시 이름 | `Divenary` |
| 한국어 보조 표기 | `다이브너리` |
| Google OAuth consent product name | `Divenary` |
| Sign in with Apple 관련 서비스 표기 | `Divenary` |
| Supabase 프로젝트 표시 이름 | `Divenary` 또는 환경을 붙인 `Divenary Dev` / `Divenary Prod` |
| 고객 지원·법적 문서의 제품명 | `Divenary` |

내부 환경 이름은 제품명과 분리한다. 개발과 운영 프로젝트는 `Divenary Dev`, `Divenary Prod`처럼 명확히 구분하며, 운영 사용자가 개발 프로젝트로 인증되는 구성을 허용하지 않는다.

## Native Identifier Strategy

현재 `org.reactjs.native.example.*` Bundle ID는 배포나 social login 설정에 사용할 수 없는 개발용 식별자다. provider console을 본격 설정하기 전에 다음 브랜드 식별자로 교체한다.

- iPhone app: `com.divenary.app`
- Watch app: `com.divenary.app.watchkitapp`
- Watch tests: `com.divenary.app.watchkitapp.tests`

Bundle ID는 OAuth client, Sign in with Apple capability, Keychain entitlement, App Store Connect record와 연결되므로 이후 임의로 변경하지 않는다. 해당 identifier가 Apple Developer 계정에서 생성 불가능한 경우에는 구현을 진행하며 다른 값을 조용히 발명하지 않고, 외부 콘솔 등록 전에 충돌 사실을 보고한다.

이번 branding 작업에서는 Xcode project, target, scheme, CocoaPods target, React Native module과 소스 디렉터리의 내부 이름 `DiveMobile` / `DiveWatchApp`을 유지한다. 사용자에게 보이지 않는 내부 이름까지 동시에 바꾸면 Auth 도입과 무관한 project-file, scheme, Pod, test-host churn이 생긴다. 내부 전체 개명은 실제 유지보수 이득이 확인될 때 별도 작업으로 수행한다.

## User-Facing Copy Rules

- 단독 로고와 navigation title에는 `Divenary`만 사용한다.
- 첫 소개나 스토어 설명에서만 `Dive log & Apple Watch companion`을 함께 사용한다.
- `다이브너리`는 한국어 발음 안내와 한국어 문장 안의 보조 표기로만 사용한다.
- `the Divenary`, `Divenary App`, `Divenary Dive Computer`를 공식 이름처럼 사용하지 않는다.
- `safe dive`, `safety system`, `underwater guidance`, `certified`처럼 안전 장비를 암시하는 문구를 브랜드 약속에 넣지 않는다.
- 사용자의 실제 동의와 계정 데이터 처리 주체를 표시해야 하는 법적 문서에서는 제품명과 운영 주체명을 구분한다. `Divenary`라는 제품명이 법적 사업자명을 대신하지 않는다.

## Rollout Boundary

브랜드 적용은 Supabase/Auth foundation의 선행 작업으로 수행한다.

1. iPhone과 Watch의 사용자 표시 이름 및 기본 UI 브랜드 문구를 `Divenary`로 통일한다.
2. Bundle ID와 관련 entitlement를 브랜드 식별자로 교체하고 두 target의 embed 관계를 검증한다.
3. 변경된 identifier를 기준으로 Apple Developer, Google Cloud OAuth, Supabase Auth provider를 설정한다.
4. 로그인과 onboarding 화면, 필수 이용약관·개인정보 문서 링크에서 `Divenary`를 사용한다.
5. 내부 target/project/module 전체 개명은 하지 않는다.

정식 공개 배포 전에 App Store 이름, 주요 배포 국가의 상표, 운영 도메인과 소셜 계정 사용 가능성을 별도 확인한다. 예비 웹 검색 결과만으로 법적 사용 가능성을 확정하지 않는다.

## Verification

- iPhone 홈 화면과 Watch 앱 목록에서 `Divenary`가 표시된다.
- iPhone app과 embedded Watch app이 새 Bundle ID 조합으로 함께 build된다.
- WatchConnectivity pairing과 기존 local import acknowledgement가 identifier 변경 후에도 동작한다.
- Google과 Apple 로그인 화면에 최종 사용자용 서비스명이 `Divenary`로 나타난다.
- 개발과 운영 build가 서로 다른 Supabase 프로젝트와 OAuth configuration을 사용하며, 운영 build가 개발 backend를 참조하지 않는다.
- 저장소의 사용자 노출 문자열에서 `DiveMobile`이 남지 않는다. 내부 target, scheme, path, test identifier에 남는 것은 허용한다.
- 앱과 스토어 문구가 인증 장비 또는 안전-critical 기능을 암시하지 않는다.

## Non-Goals

- 로고, 아이콘, 색상 체계와 typography 제작
- Xcode project/target/scheme, CocoaPods target, native module과 디렉터리의 전면 개명
- 법인명 또는 개발자 계정 소유 주체 결정
- 상표 출원, 도메인 구매, App Store Connect 등록 자체
- Android application ID와 Android social login 구현
