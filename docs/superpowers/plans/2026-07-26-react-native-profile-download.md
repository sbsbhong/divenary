# React Native 원격 Watch 프로파일 다운로드 수정 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다른 기기에서 Supabase에 저장한 Watch 다이빙 프로파일을 React Native 앱이 내려받아 계정 로그로 게시하고, 성공 후 Home의 `remoteHydration` 경고를 해제한다.

**Architecture:** `packages/supabase`의 Storage repository가 웹 `Blob.arrayBuffer()`와 React Native `FileReader.readAsArrayBuffer()`를 모두 지원하도록 Blob→`Uint8Array` 변환 경계를 한 함수에 둔다. 모바일 패키지는 전역 `TextDecoder`가 없는 React Native에서도 엄격하게 동작하는 공용 UTF-8 디코더를 사용한다. 계정 hydration과 UI 상태 코드는 그대로 두어 기존 SHA-256·byte count·sample count fail-closed 검증을 재사용한다.

**Tech Stack:** TypeScript, Node test runner, Supabase Storage, React Native 0.85, Jest, AsyncStorage

## Global Constraints

- 기존 Watch/Xcode dirty 변경은 수정하거나 stage하지 않는다.
- Supabase schema, RLS, bucket 또는 원격 데이터는 변경하지 않는다.
- 원격 profile의 SHA-256, byte count, sample count 검증은 완화하지 않는다.
- 웹 Blob의 기존 `arrayBuffer()` 경로를 유지한다.
- React Native native Blob에 `arrayBuffer()`가 없을 때만 `FileReader` fallback을 사용한다.
- malformed UTF-8은 기존과 동일하게 거부하고 무효한 profile을 JSON parser에 넘기지 않는다.
- Home UI 문구와 레이아웃은 변경하지 않는다.

---

### Task 1: React Native Blob 회귀 테스트와 교차 플랫폼 변환

**Files:**
- Modify: `packages/supabase/src/guest-claim-repository.ts`
- Modify: `packages/supabase/src/guest-claim-repository.test.ts`

**Interfaces:**
- Consumes: `GuestClaimRemoteRepository.downloadProfile(path): Promise<Uint8Array>`
- Produces: `blobBytes(blob: Blob): Promise<Uint8Array>`와 React Native형 native Blob 회귀 테스트

- [x] **Step 1: `arrayBuffer`가 없는 Blob fixture를 추가한다**

```ts
const nativeBlob = {size: bytes.length, type: 'application/json'} as Blob;
```

- [x] **Step 2: `FileReader.readAsArrayBuffer()`만 제공하는 runtime을 설치한다**

```ts
class NativeBlobFileReader {
  result: string | ArrayBuffer | null = null;
  error: DOMException | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    assert.equal(blob, nativeBlob);
    this.result = bytes.slice().buffer;
    queueMicrotask(() => this.onload?.({} as ProgressEvent<FileReader>));
  }
}
```

- [x] **Step 3: 다운로드 결과가 원본 bytes와 같은지 검증한다**

```ts
assert.deepEqual(await repository.downloadProfile(path), bytes);
```

- [x] **Step 4: focused test를 실행해 현재 구현이 실패하는지 확인한다**

Run:

```sh
yarn workspace @repo/supabase test
```

Expected: 새 테스트가 `result.data.arrayBuffer is not a function`을 감싼 `GuestClaimRepositoryError`로 실패한다.

- [x] **Step 5: 웹 Blob의 기존 fast path를 보존한다**

```ts
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = Reflect.get(blob, 'arrayBuffer');
  if (typeof arrayBuffer === 'function') {
    return new Uint8Array(await arrayBuffer.call(blob));
  }
  return readBlobWithFileReader(blob);
}
```

- [x] **Step 6: React Native `FileReader` fallback을 구현한다**

```ts
function readBlobWithFileReader(blob: Blob): Promise<Uint8Array> {
  if (typeof globalThis.FileReader !== 'function') {
    throw new TypeError('Blob bytes are unavailable');
  }
  return new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new TypeError('Blob bytes are unavailable'));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.onerror = () =>
      reject(reader.error ?? new TypeError('Blob bytes are unavailable'));
    reader.onabort = () => reject(new TypeError('Blob read was aborted'));
    reader.readAsArrayBuffer(blob);
  });
}
```

- [x] **Step 7: Storage download에서 공용 변환을 사용한다**

```ts
return blobBytes(result.data);
```

- [x] **Step 8: focused test를 다시 실행해 통과를 확인한다**

Run:

```sh
yarn workspace @repo/supabase test
```

Expected: 모든 Supabase package 테스트가 통과한다.

### Task 2: React Native 호환 strict UTF-8 profile 디코딩

**Files:**
- Create: `apps/mobile/src/utils/utf8.ts`
- Create: `apps/mobile/__tests__/utf8.test.ts`
- Modify: `apps/mobile/src/claim/profile-bytes.ts`
- Modify: `apps/mobile/src/sync/account-sync-coordinator.ts`
- Modify: `apps/mobile/__tests__/account-sync-coordinator.test.ts`

**Interfaces:**
- Consumes: Storage repository가 반환한 `Uint8Array`
- Produces: 전역 `TextDecoder` 유무와 관계없이 동일하게 엄격한 UTF-8 문자열

- [x] **Step 1: React Native runtime 회귀 테스트를 먼저 추가한다**

전역 `TextDecoder`가 없는 상태에서 ASCII JSON, 한국어, supplementary Unicode를 디코딩하는 테스트와 malformed·truncated·overlong·surrogate·범위 초과 UTF-8을 거부하는 테스트를 작성한다. Native `TextDecoder`와 fallback의 의미가 같도록 선두 UTF-8 BOM 하나를 제거하는 테스트도 포함한다.

- [x] **Step 2: 테스트가 현재 구현 또는 미구현 import로 실패하는지 확인한다**

Run:

```sh
yarn workspace @repo/mobile test --runTestsByPath __tests__/utf8.test.ts --runInBand
```

Expected: 공용 디코더가 없어 RED로 실패한다.

- [x] **Step 3: strict UTF-8 공용 디코더를 구현한다**

지원되는 runtime에서는 `TextDecoder('utf-8', {fatal: true})`를 사용하고, React Native fallback은 RFC 3629 범위만 허용한다. continuation byte, overlong encoding, UTF-16 surrogate, U+10FFFF 초과, truncated sequence를 모두 거부한다. fallback은 native decoder처럼 선두 UTF-8 BOM 하나를 제거한다. 큰 profile도 안전하도록 문자열 생성은 작은 chunk로 flush한다.

- [x] **Step 4: profile hydration의 두 decode call site를 공용 디코더로 교체한다**

`account-sync-coordinator.ts`의 Noble `bytesToUtf8`와 `claim/profile-bytes.ts`의 직접 `TextDecoder` 호출을 제거한다. 기존 SHA-256·byte count 검증 순서는 유지한다.

- [x] **Step 5: coordinator 통합 회귀 테스트를 추가한다**

전역 `TextDecoder`가 없는 상태에서 Watch remote profile을 hydrate하고 profile bytes와 log metadata가 모두 저장되며 `AccountHydrationError`가 발생하지 않는지 검증한다.

- [x] **Step 6: focused tests와 typecheck를 통과시킨다**

Run:

```sh
yarn workspace @repo/mobile test --runTestsByPath __tests__/utf8.test.ts __tests__/account-sync-coordinator.test.ts __tests__/guest-claim-service.test.ts --runInBand
yarn mobile:typecheck
```

Expected: 모든 관련 테스트와 TypeScript 검사가 통과한다.

### Task 3: 동기화 지식과 검증

**Files:**
- Create: `.wiki/raw/architecture/2026-07-26-react-native-profile-download-recovery.md`
- Modify: `.wiki/wiki/architecture/sync-flow.md`
- Modify: `.wiki/wiki/index.md`
- Modify: `.wiki/wiki/log.md`
- Delete: `apps/mobile/__tests__/account-watch-observed-diagnostic.test.ts`

**Interfaces:**
- Consumes: 실제 simulator URL cache의 Storage HTTP 200, descriptor 일치, React Native Blob API 근거
- Produces: 재발 방지를 위한 package 경계와 검증 근거

- [x] **Step 1: 진단 근거를 immutable raw source로 기록한다**

원격 row 5개 조회, profile GET 200, SHA-256·1,585 bytes·6 samples 일치, React Native Blob의 `arrayBuffer()` 부재와 `FileReader` fallback, React Native의 전역 `TextDecoder` 부재와 strict UTF-8 fallback 결정을 기록한다. 사용자 식별자와 토큰은 기록하지 않는다.

- [x] **Step 2: `sync-flow.md`에 profile 다운로드 runtime 경계를 추가한다**

`packages/supabase`가 웹 Blob은 `arrayBuffer()`, React Native native Blob은 `FileReader.readAsArrayBuffer()`로 변환한 뒤, 모바일의 strict UTF-8 decoder와 기존 integrity 검증에 넘긴다는 사실을 기록한다.

- [x] **Step 3: 진단 전용 실제 사용자 fixture 테스트를 삭제한다**

`apps/mobile/__tests__/account-watch-observed-diagnostic.test.ts`는 커밋하지 않는다.

- [x] **Step 4: 관련 검증을 실행한다**

Run:

```sh
yarn workspace @repo/supabase test
yarn workspace @repo/supabase typecheck
yarn workspace @repo/mobile test --runTestsByPath __tests__/account-sync-coordinator.test.ts __tests__/account-data-state.test.tsx --runInBand
yarn mobile:typecheck
yarn ios:build
yarn codex:check
```

Expected: 모든 명령이 exit 0이며, 사용자 소유 native 변경 때문에 별도 전체 mobile suite가 실패하면 해당 기존 실패를 분리해 보고한다.

- [ ] **Step 5: 독립 리뷰 뒤 branch를 main에 병합한다**

리뷰어가 Critical/Important 문제 없음으로 확인한 뒤 수정 파일만 stage·commit하고, 명시된 사용자 선택에 따라 `main`에 fast-forward 병합한 다음 merged result에서 핵심 테스트를 다시 실행한다.
