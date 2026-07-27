Source URL: apps/mobile/src/sync/account-payload.ts; packages/supabase/src/account-data-numbers.ts; simulator account cache
Collected: 2026-07-27
Published: 2026-07-27

# Account float readback precision recovery evidence

## Reported failure

- 최신 빌드의 실기기와 시뮬레이터 모두 account hydration이 `Malformed remote log (2 failures)`로 중단됐다.
- 시뮬레이터 cache에는 remote log 10개가 있었지만 local hydration 결과는 8개였고, 누락된 2개는 모두 Apple Watch 데모 세션이었다.
- 수동으로 만든 log는 정상 hydrate됐으며, 누락된 Watch log도 Supabase table에는 정상 저장돼 있었다.
- 안전한 aggregate error 아래의 실제 row 오류는 두 건 모두 `Malformed remote log payload digest`였다.

## Observed typed readback differences

Supabase typed column의 REST readback과 payload에 보존된 Watch source 사이에서 다음 차이를 확인했다.

| Field | Embedded Watch source | Typed REST readback | Binary64 distance |
| --- | ---: | ---: | ---: |
| `durationSeconds` | `13.890705108642578` | `13.8907051086426` | 12 ULP |
| `maxDepthMeters` | `6.917554998405613` | `6.91755499840561` | 4 ULP |
| `durationSeconds` | `18.46345806121826` | `18.4634580612183` | 11 ULP |

각 row에서 typed readback 값을 embedded Watch source 값으로 복원하면 전체 payload SHA-256은 원격에 저장된 digest와 정확히 일치했다. 따라서 payload 손상이나 row 누락이 아니라, PostgreSQL numeric 값의 REST decimal serialization이 기존 one-ULP 허용 범위를 넘긴 것이 원인이었다.

## Implemented compatibility rule

- `duration_seconds`와 `max_depth_meters`의 typed readback은 exact/adjacent binary64 값이거나 `Number(sourceValue.toPrecision(15))`와 정확히 같을 때만 embedded source 값으로 복원한다.
- 비교는 directional이다. embedded payload source에서 typed REST representation으로 향하는 경우만 허용하며, 반대 방향이나 임의의 근삿값은 허용하지 않는다.
- 복원한 전체 payload의 SHA-256이 저장된 digest와 정확히 일치해야만 row를 수용한다.
- 일반 epsilon, 임의 ULP 폭, digest 재작성은 사용하지 않는다.
- PostgreSQL `integer`인 `rating`은 exact comparison을 유지하고, source/hash mismatch는 계속 fail-closed다.

## Verification evidence

- `@repo/supabase` package test 70개가 통과했다.
- mobile account sync coordinator test 78개가 통과했다.
- 두 실제 Watch decimal 조합과 허용 범위를 벗어난 decimal 차이를 회귀 테스트로 고정했다.
