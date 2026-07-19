# Guest Data Account Claim Design

## Context

현재 Divenary는 Google/Apple 로그인과 필수 동의를 지원하지만 Logbook과 Planbook은 하나의 비분할 AsyncStorage 저장소를 사용한다. 따라서 로그인 전 기록이 로그인 뒤에도 그대로 보이고, 사용자는 이 기록이 계정에 저장됐는지 기기에만 남아 있는지 구분할 수 없다. 원격에는 Auth 관련 table만 있고 `dive_logs`, `dive_plans`, profile Storage는 아직 없다.

이번 변경은 로그인 완료 뒤 기기 데이터를 계정으로 가져올지 명시적으로 선택하게 하고, 가져오는 동안 `3 / 32` 형태의 정확한 진행률을 보여주는 end-to-end account claim을 만든다. 데이터 손실 방지가 시각적 완성도보다 우선하며, Watch의 `synced` 표시는 계속 iPhone 로컬 저장 완료만 의미한다.

## Product Decision

- 로그인 완료 후 unclaimed guest Logbook 또는 Planbook이 하나라도 있으면 account claim sheet를 연다.
- 사용자는 `계정으로 가져오기` 또는 `기기에 유지`를 선택한다.
- `기기에 유지`를 선택해도 로그인은 유지한다. guest record는 signed-in Logbook/Planbook에 함께 보이되 `기기 저장` label로 source를 명확히 한다.
- Settings에서 `기기 데이터 가져오기`를 다시 실행할 수 있다.
- 한 claim은 Logbook과 Planbook을 함께 다룬다. `convertedLogLocalId` 관계가 깨지지 않도록 plan과 log를 별도 claim으로 나누지 않는다.
- 진행률의 total은 log count + plan count다. profile file은 해당 log step에 포함하며 별도 count로 표시하지 않는다.
- 한 record의 metadata, 관계, 필요한 profile object가 원격에 저장되고 검증된 뒤에만 completed count를 1 올린다.
- 실행 중 sheet는 swipe-down, close button, back gesture로 닫을 수 없다. 앱 background와 process termination은 허용하고 다음 foreground에서 같은 manifest를 재개한다.
- 실패 시 guest 원본을 보존하고 `다시 시도`, `기기에 유지`를 제공한다.
- 전체 batch가 검증되어 원격에 공개된 뒤에만 guest 원본을 제거하고 account Logbook/Planbook을 보여준다.

## Subject, Audience, and Job

- **Subject:** 다이버가 iPhone에 쌓아 둔 다이빙 기록을 자신의 Divenary 계정으로 옮기는 순간.
- **Audience:** 로그인 전에도 기록을 작성했고, 자신의 로그가 사라지거나 중복될 가능성에 민감한 returning diver.
- **Single job:** 어떤 데이터가 어디에 저장되는지 분명히 보여주고, 중단 가능한 긴 이전을 불안 없이 끝내게 한다.

## Explored UI Directions

### A. System alert followed by a progress screen

짧지만 앱 시작 직후 alert가 튀어나오고, 선택 뒤 다른 surface로 전환되어 맥락이 끊긴다. Apple HIG도 alert를 드물게 사용하고 예상치 못한 startup alert를 피하도록 권장한다. 제외한다.

### B. One native form sheet with state transitions

로그인 sheet가 끝난 뒤 같은 visual grammar의 별도 claim `formSheet`를 열고, 선택, 진행, 실패, 완료를 한 surface 안에서 전환한다. task scope가 분명하고 stacked modal을 피할 수 있다. **채택한다.**

### C. Full-screen migration flow

대량 데이터에는 공간이 충분하지만 현재 record 수와 작업 복잡도에 비해 무겁고, 로그인 뒤 사용자가 앱으로 돌아간다는 기대를 깨뜨린다. 제외한다.

## Visual Direction

### Palette

구현은 아래 색을 직접 component에 쓰지 않고 기존 Gluestack semantic token으로 사용한다.

- **Divenary Blue `#0066CC`:** primary action과 completed progress.
- **Cloud White `#FFFFFF`:** light sheet surface.
- **System Mist `#F5F5F7`:** grouped background와 quiet control surface.
- **Dive Ink `#1D1D1F`:** title과 primary information.
- **Gauge Gray `#7A7A7A`:** secondary label과 pending information.
- **Signal Red `#E7000B`:** destructive/failure state에만 제한.

Dark mode는 현재 semantic dark tokens (`background #000000`, `card #272729`, `primary #2997FF`)를 그대로 사용한다. color만으로 상태를 전달하지 않고 text와 icon을 함께 쓴다.

### Type

- **Display:** iOS system의 SF Pro Display 계열에 해당하는 native system heading, Android에서는 같은 size/weight/line-height를 적용한 platform system sans. 별도 Apple font file을 번들하지 않는다.
- **Body:** native system text, 15-17pt 범위, Dynamic Type multiplier를 허용한다.
- **Data:** native system text에 `fontVariant: ['tabular-nums']`를 적용해 `3 / 32` 폭이 흔들리지 않게 한다.
- letter spacing은 0으로 유지한다. heading은 2줄까지 허용하며 viewport width로 font size를 계산하지 않는다.

### Layout

Sheet 안에서 icon, title, count, progress, actions가 하나의 수직 리듬을 이룬다. 설명 card를 중첩하지 않고 divider와 whitespace로 정보 구조를 만든다.

```text
Choice                                      Progress
┌──────────────────────────────┐            ┌──────────────────────────────┐
│          cloud icon          │            │          cloud icon          │
│ 기기 데이터를 계정으로      │            │ 계정으로 가져오는 중        │
│ 가져올까요?                  │            │                              │
│                              │            │                    3 / 32    │
│ 다이빙 로그              24  │            │ █████░░░░░░░░░░░░░░░░░░░░  │
│ 다이빙 계획               8  │            │                              │
│ ──────────────────────────── │            │ 현재 기록 이름               │
│ [    계정으로 가져오기     ] │            │                              │
│       기기에 유지           │            │        dismiss 없음          │
└──────────────────────────────┘            └──────────────────────────────┘

Failure                                     Kept on device
┌──────────────────────────────┐            Log/plan row
│ 가져오기를 완료하지 못했습니다│            ┌──────────────────────────────┐
│                    11 / 32   │            │ Jeju Moon Island  [기기 저장]│
│ [        다시 시도          ] │            │ 2026. 7. 19                  │
│       기기에 유지            │            └──────────────────────────────┘
└──────────────────────────────┘
```

### Signature

유일한 signature element는 **depth trace progress**다. 두꺼운 generic loading bar 대신 2px track 위에 Divenary Blue fill과 작은 current-position tick을 두고, 오른쪽에 tabular count를 정렬한다. 다이빙 profile trace를 연상시키지만 실제 depth data처럼 보이거나 안전 정보를 암시하지 않는다. Reduce Motion에서는 tick/fill 전환 animation을 제거하고 즉시 width를 갱신한다.

### Self-critique

초안의 cloud icon, blue progress, rounded sheet만으로는 일반적인 backup UI와 구분되지 않았다. decorative wave, gradient, 큰 illustration을 추가하는 대신 Divenary에 이미 존재하는 profile trace의 정밀한 선과 record-level 현재 항목을 signature로 선택했다. 나머지는 Apple식 위계와 spacing에 집중해 한 곳만 기억에 남도록 제한한다.

## UI State Model

```ts
export type GuestClaimErrorCode =
  | 'network_unavailable'
  | 'session_expired'
  | 'profile_missing'
  | 'profile_corrupt'
  | 'relationship_invalid'
  | 'remote_conflict'
  | 'claim_validation_failed';

export type GuestClaimViewState =
  | { status: 'hidden' }
  | { status: 'choice'; logCount: number; planCount: number }
  | { status: 'running'; completed: number; total: number; currentLabel?: string }
  | { status: 'failed'; completed: number; total: number; errorCode: GuestClaimErrorCode }
  | { status: 'complete'; imported: number };
```

- `choice`: primary action과 quiet text action만 표시한다.
- `running`: interactive dismiss를 모두 막고 determinate progress만 표시한다.
- `failed`: error code를 사용자 action 중심 copy로 매핑하고 raw server message를 보여주지 않는다.
- `complete`: 별도 성공 modal을 쌓지 않는다. accessibility announcement 후 sheet를 닫고 account data query를 invalidate한다.
- `authenticatedOffline`에서는 claim을 시작하지 않는다. 이미 실행 중인 manifest가 있으면 `failed`가 아니라 network 대기 상태로 유지하고 online foreground에서 재개한다.

## Copy

Korean source copy:

- Choice title: `기기 데이터를 계정으로 가져올까요?`
- Counts: `다이빙 로그`, `다이빙 계획`
- Primary: `계정으로 가져오기`
- Secondary: `기기에 유지`
- Progress title: `계정으로 가져오는 중`
- Progress count: `{{completed}} / {{total}}`
- Failure title: `가져오기를 완료하지 못했습니다`
- Retry: `다시 시도`
- Local badge: `기기 저장`
- Settings action: `기기 데이터 가져오기`

추가 설명은 데이터가 안전하다는 사실이나 사용자가 다음에 할 수 있는 action을 전달할 때만 넣는다. `백업`, `동기화 완료`, `클라우드 저장됨` 같은 표현은 server verification 전에는 사용하지 않는다.

## Data Architecture

### Local principal partitions

- `guest`와 `user:<uuid>`를 principal key로 사용한다.
- 기존 `dive-app:logbook:v2`, `dive-app:planbook:v2` envelope은 migration marker가 없을 때 정확히 한 번 `guest` partition으로 이동한다.
- profile file key도 principal을 포함한다. guest source file은 final verification 전 삭제하지 않는다.
- `GuestClaimManifest`는 batch id, user id, immutable ordered item list, profile digest, remote record id, completed item ids, state를 저장한다.
- Mobile SHA-256은 현재 lockfile에 이미 존재하는 audited `@noble/hashes@1.8.0`을 direct dependency로 고정해 iOS/Android에서 같은 byte digest를 만든다. React Native Web Crypto availability에 의존하거나 SHA-256을 직접 구현하지 않는다.
- manifest snapshot 이후 만들어진 guest record는 현재 batch에 끼워 넣지 않는다. 완료 후 Settings에 남은 count로 다시 제안한다.

### Remote claim staging

- `guest_claim_batches`는 owner, client batch id, expected counts, manifest digest, status를 가진다.
- `guest_claim_records`는 batch 안의 plan/log payload와 profile metadata를 임시 저장한다.
- `(batch_id, entity_kind, client_record_id)` uniqueness로 retry를 idempotent하게 만든다.
- staging row는 일반 Logbook/Planbook query에 포함되지 않는다.
- private `dive-profiles` bucket object는 immutable path에 create-only로 upload한다.

### Server verification and publication

1. Mobile은 한 item의 staging metadata를 upsert한다.
2. Log item에 full profile이 있으면 immutable object를 upload한다.
3. Mobile이 object를 read-back하여 SHA-256과 sample count를 검증한다.
4. 모든 item이 준비되면 authenticated Edge Function `finalize-guest-claim`을 호출한다.
5. Edge Function은 caller JWT를 검증하고 profile object를 server-side로 읽어 SHA-256, byte count, sample count를 다시 확인한다.
6. service-role-only database RPC가 expected count, owner, duplicate client id, plan-log 관계, verified profile list를 검증한다.
7. 한 transaction에서 `dive_plans`, `dive_logs`를 upsert하고 batch를 `committed`로 바꾼다.
8. Mobile은 committed rows를 내려받아 `user:<uuid>` partition을 확인한 후 guest records/profile을 삭제한다.

DB finalizer는 `SECURITY DEFINER`가 필요하지만 `PUBLIC`, `anon`, `authenticated` execute를 모두 revoke하고 `service_role`에만 grant한다. fixed empty `search_path`, schema-qualified object, explicit owner parameter validated by the Edge Function, immutable batch transition을 사용한다. 일반 app table과 staging table은 explicit grants와 owner RLS를 모두 적용한다.

## Progress Semantics

- Ordered items는 plans first, logs second로 만든다. 먼저 plan remote id를 확정해 log의 plan relationship을 보존한다.
- UI order는 내부 upload order와 무관하게 total만 보여준다.
- item completion은 manifest에 영구 저장한 뒤 UI count를 올린다. 재시작 시 memory count가 아니라 manifest 완료 항목 수를 사용한다.
- finalizer 단계 동안 count는 `total / total`까지 올라갈 수 있지만 sheet는 committed response 전 닫지 않는다. progress track은 100%를 유지하고 title은 바꾸지 않아 spinner/bar shape 전환을 피한다.
- `total === 0`이면 sheet를 열지 않는다.

## Relationship Rules

- Plan의 `convertedLogLocalId`가 같은 manifest의 log를 가리키면 final remote relationship으로 변환한다.
- target log가 guest snapshot에 없거나 이미 삭제됐으면 invalid relationship으로 기록하지 않고 claim을 실패시킨다. 원본을 보존한 상태에서 사용자가 local data를 정리한 뒤 재시도한다.
- Log와 Plan의 `client_record_id`는 기존 `localId`를 사용한다. server id는 별도 UUID다.
- 같은 user와 client record id가 이미 committed되어 digest가 같으면 성공으로 취급한다. payload digest가 다르면 conflict로 실패하고 overwrite하지 않는다.

## Error and Recovery

- Network, timeout, app termination: manifest와 guest source를 보존하고 online foreground에서 같은 batch를 재개한다.
- Provider/session expiry: claim을 멈추고 Auth revalidation 뒤 재개한다. 다른 user로 로그인하면 이전 manifest를 열거나 전송하지 않는다.
- Profile missing/corrupt: 해당 log item을 완료하지 않고 failure state를 보여준다.
- Server count/digest/relationship mismatch: batch를 committed로 바꾸지 않고 모든 staging data를 일반 query에서 숨긴다.
- `기기에 유지`: active manifest를 `deferred`로 표시하되 guest source와 uploaded staging artifacts는 보존한다. 다음 retry는 같은 batch를 사용해 불필요한 재업로드를 피한다.
- Guest cleanup failure after remote commit: account data는 유지하고 cleanup-pending state를 재시도한다. 동일 데이터를 guest와 account에 동시에 일반 목록으로 노출하지 않도록 committed manifest의 guest ids를 presentation layer에서 숨긴다.

## Accessibility and Motion

- Progress root에 `accessibilityRole="progressbar"`, `accessibilityValue={{ min: 0, max: total, now: completed }}`를 준다.
- count change는 매 record마다 screen reader를 방해하지 않도록 1초 단위로 묶어 announce하고, completion/failure는 즉시 announce한다.
- Dynamic Type 200%, Korean/English longest copy, 320pt width에서 button text가 잘리지 않아야 한다.
- status를 blue/red만으로 구분하지 않는다.
- Reduce Motion에서는 progress width animation, press scale, entrance transition을 제거한다.
- iOS와 Android 모두 같은 information hierarchy, spacing, semantic colors를 사용한다. Android에서도 custom platform-specific marketing treatment를 추가하지 않는다.

## Testing Strategy

- Database: grants, RLS owner isolation, membership requirement, staging idempotency, service-role-only finalizer, count/digest/relationship rejection, atomic visibility.
- Edge Function: missing/invalid JWT, cross-owner batch, missing object, digest/sample mismatch, repeated finalization.
- Package: remote model mapping, cursor behavior, sanitized errors.
- Mobile local: one-time legacy-to-guest migration, principal isolation, manifest persistence, plan-first order, interrupted resume, post-commit cleanup.
- Mobile UI: choice counts, `3 / 32`, progress accessibility values, non-dismissible running state, retry/keep-device actions, local badge, Settings retry action, Dynamic Type layout.
- Integration: Apple/Google signed login, 32-record interrupted import, force quit/resume, profile corruption, offline transition, second account isolation, Watch local ACK regression.

## Non-Goals

- Android native Google/Apple login provider setup. Android에 이미 authenticated session이 주어졌을 때 claim UI와 data path는 동일하게 동작한다.
- Realtime, collaborative merge, CRDT, field-level conflict UI.
- Account deletion, soft deletion, public profile, friends, media upload.
- Watch에 Supabase client나 user id 추가.
- 감압, 상승 허가, 비상 판단 등 safety-critical 기능.

## References

- [Apple Human Interface Guidelines: Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
- [Apple Human Interface Guidelines: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- [Apple Human Interface Guidelines: Modality](https://developer.apple.com/design/human-interface-guidelines/modality)
- [Apple Human Interface Guidelines: Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)
- [Apple Human Interface Guidelines: Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Apple Accessibility: Larger text](https://developer.apple.com/design/human-interface-guidelines/accessibility#Larger-text)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase database function security](https://supabase.com/docs/guides/database/functions)
- [Supabase Edge Functions Auth](https://supabase.com/docs/guides/functions/auth)
