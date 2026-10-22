Source URL: project conversation; apps/mobile/src/sync/account-sync-coordinator.ts; apps/mobile/src/screens/logbook/screen.tsx; apps/mobile/src/states/account-data.tsx; apps/mobile/src/states/use-dive-logbook.ts; apps/mobile/src/states/use-dive-plans.ts; apps/mobile/src/repositories/persistent-dive-log-repository.ts; apps/mobile/src/claim/guest-claim-store.ts; apps/mobile/src/claim/guest-claim-service.ts; apps/mobile/ios/DivenaryWatchApp/Runtime/RealDiveSessionCoordinator.swift; packages/contracts/schemas/watch-link-messages.schema.json; packages/contracts/schemas/watch-planned-dive.schema.json; apps/mobile/__tests__/watch-link-contract.test.ts
Collected: 2026-10-22
Published: 2026-10-22

# 2026-10-22 로그북 페이지 로딩, 저장 형식 정리, 폰-워치 메시지 contract

사용자는 앞선 성능 정리에서 남긴 일을 모두 진행하라고 했고, 모바일이 Supabase에 저장한 로그를 페이지 단위로 가져와 무한 스크롤로 보여주고 상단에 전체 로그 개수를 적으라고 했다. 이어서 로그북 탭에서 검색창 아래 로그 목록만 스크롤되게 하고, 하단 로그북 탭을 누르면 맨 위로 올라가게 하라고 했다.

## 클라우드 로그 페이지 로딩

- `AccountDataRepository.listLogs`는 이미 `started_at` 내림차순 keyset cursor로 페이지를 준다. 이전 hydrate는 모든 페이지를 모은 뒤에 적용했다.
- 이제 hydrate는 계획과 로그를 페이지마다 바로 적용한다. 페이지에서 바뀐 행이 있으면 `onHydratedPage`가 호출되고 account-data가 목록 query를 갱신하므로, 뒤 페이지를 내려받는 동안 앞 페이지 로그가 먼저 보인다.
- 로컬 우선 구조는 그대로다. 모든 원격 행을 로컬에 저장하므로 검색, 통계, claim 비교, 워치 가져오기 중복 검사가 일부 페이지에만 의존하지 않는다. 화면 스크롤이 원격 페이지 요청을 직접 끌지 않고, 남은 페이지는 백그라운드에서 이어서 받는다.
- account-data는 클라우드 다운로드가 진행 중인지 `isCloudRefreshing`으로 알린다.

## 로그북 화면

- 제목, 작성하기·워치 동기화 버튼, 검색창, 전체 개수 줄은 위에 고정하고 그 아래 목록만 스크롤한다. 목록은 `FlatList`다.
- 전체 개수는 로컬 로그북의 개수이며 `전체 로그 N개`로 보인다. 검색 중에는 `검색 결과 M개 · 전체 N개`로 보인다. 클라우드에서 받는 중이면 `클라우드에서 불러오는 중`을 함께 보인다.
- 목록은 20개를 보이고 끝에 가까워지면 20개씩 더한다. 더 보일 행이 있거나 클라우드 페이지가 오는 중이면 목록 끝에 표시가 뜬다. 새 검색은 첫 페이지부터 다시 보인다.
- 활성 로그북 탭을 다시 누르면 목록을 맨 위로 올리고 새로고침한다.
- 당겨서 새로고침 표시는 당기는 동작에만 붙인다. iOS에서는 백그라운드 새로고침에 그 표시를 켜면, 코드로 스크롤한 목록 위에 빈 여백이 남았다. 훅의 `isRefreshing`은 사용자가 요청한 새로고침만 뜻한다.
- iPhone 17 Pro 시뮬레이터에서 고정 헤더, 목록만 스크롤, 무한 스크롤, 탭 재선택 후 맨 위 이동을 확인했다.

## 저장 형식과 claim

- 로그북 schema 4는 워치 로그의 160개 미리보기가 `watchCapture.samples`와 `watchCapture.session.samples`에 같을 때 session 쪽을 저장하지 않고, 읽을 때 되돌린다. 두 값이 다르면 둘 다 저장한다. schema 3도 읽는다. 원격 payload와 claim digest는 바뀌지 않는다.
- 삭제된 워치 세션으로 claim을 무효화할 때, 저장된 claim text에 그 session id가 없으면 검증된 전체 읽기를 건너뛴다. JSON이 escape하지 않는 문자로만 된 id에만 적용한다.
- 메모리에 검증된 사본이 없는 claim을 읽을 때 sidecar를 하나씩 검사하며 사이마다 JS thread를 양보한 뒤 전체 parse가 그 결과를 재사용한다.

## Watch 저장 화면

- 다이빙이 끝나면 coordinator가 저장 중 단계로 바꾼 뒤 한 frame쯤 지나서 저장한다. 그 사이 같은 기록이 아직 저장 중일 때만 저장한다. 저장 실패 화면을 벗어나 다음 다이빙을 시작하는 경로는 결과가 바로 필요해서 즉시 저장한다. 데모 기록 화면은 바꾸지 않았다.

## 폰-워치 메시지 contract

- `packages/contracts/schemas/watch-link-messages.schema.json`이 파일 metadata, import acknowledgement, planned dive context, 삭제 명령, 삭제 acknowledgement를 정의하고, `watch-planned-dive.schema.json`이 계획 다이브 모양을 정의한다. `yarn check:quick`이 TypeScript와 Swift type을 생성한다.
- 모바일 `WatchLink` type은 생성된 TypeScript type을 쓴다. Watch target은 생성된 Swift를 컴파일하지 않으며, `__tests__/watch-link-contract.test.ts`가 보내는 쪽 Swift 코드의 key 철자와 양쪽의 `kind`, 계획 다이브 key를 검사한다.
- 받는 쪽은 모르는 선택 key를 무시해도 된다. 워치는 `sentAt`을 보내고 폰은 읽지 않으며, 폰은 계획 context의 `updatedAt`을 보내고 워치는 읽지 않는다.

## 정리

- 이전 개발 빌드의 임시 trace가 남긴 `dive-app:debug:bootstrap-trace` key를 앱 시작 때 지운다.
