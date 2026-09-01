# Watch Saved Summary Back Navigation Design

## 목표

real session이 local save된 뒤 큰 `Done` 버튼 없이 일반적인 좌측 상단 뒤로가기로 Home에 돌아간다. `Edit details on iPhone.` 안내는 saved summary의 스크롤 최하단에 작게 남긴다.

## 화면과 상태 전이

- `savedSummary`에서만 toolbar의 좌측 상단 뒤로가기 버튼을 보인다.
- 버튼은 `dismissSavedSummary()`를 호출한다. 이 메서드는 먼저 `idle`로 전환한 뒤 현재 `WaterSubmersionState`를 즉시 다시 평가한다.
- 재평가 결과가 `submerged`이면 Wet Ready에 즉시 진입한다. `notSubmerged` 또는 `unknown`이면 Home을 유지한다.
- 따라서 수면에서 Water Lock을 해제해 Home으로 돌아간 직후 다시 입수하면 새 `submerged` event로 Wet Ready가 시작되고, 이미 재입수해 같은 `submerged` 상태가 유지된 경우에도 back navigation이 Wet Ready를 복구한다.

## 범위와 비범위

- `Saved` summary의 큰 primary button만 제거한다. 시작 실패와 no-sample 흐름의 `Done` 버튼은 바꾸지 않는다.
- demo/debug의 explicit Save/Discard는 그대로 둔다.
- 저장·재시도·record ID·runtime adoption·active plan lock과 Water Lock의 system behavior는 바꾸지 않는다.

## 검증

- coordinator test는 saved summary dismissal이 idle 뒤 현재 submerged state에서 Wet Ready를 복구하는지 검증한다.
- static UI check은 real saved summary에 large bottom Done action이 없고 iPhone 편집 안내가 summary scroll content 안에 있는지 검증한다.
- focused coordinator tests, watch UI check, simulator watch build를 실행한다.
