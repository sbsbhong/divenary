Source URL: docs/superpowers/specs/2026-10-23-watch-plumb-redesign/DECISIONS.md; docs/superpowers/specs/2026-10-23-watch-plumb-redesign/COPY-OVERRIDES.md (C6, C12, C15)
Collected: 2026-10-23
Published: 2026-10-23

# 2026-10-23 워치 Plumb polish 리뷰 결정과 수정 목록

아래 원문은 리뷰 뒤 `DECISIONS.md`의 D20과 `COPY-OVERRIDES.md`의 C6, C12, C15를 그대로 옮긴 것이다. 소유자가 리뷰에서 요청한 수정 14개는 그 뒤에 적는다.

## D20. Implementation review decisions (Task 2)
- End page without an Action Button: the large instruction already says "수중 잠금 해제 / 기록 종료·저장", so the column's bottom-slot Water Lock line is hidden on the End page and the hint chip shows dots only for `.waterLockToEnd`. With an Action Button the chip shows "동작 버튼 ▸ 기록 종료·저장" and the bottom-slot Water Lock line stays (it is the other way to end at the surface, as drawn on the canvas End board).
- Ending overlay: the recording instrument stays visible at 30 % under the spinner and "기록을 종료하고 있습니다." (RC-END), not an opaque screen.
- Recommended-stop record layout follows C6: "상태" full width, "스탑 구간 시간" on its own row, "목표 수심 / 스탑 구간" full width, then "시작" | "완료 시각".
- Korean copy keeps "Divenary" and its particle on one line (word joiner U+2060 between "Divenary" and the particle in ko catalog values).
- Each value row is one VoiceOver element ("라벨, 값"); unknown values read "정보 없음" (key `Not available`).
- The max-depth ghost line hides while the current-depth index is within 3 pt of it (they would overlap).
- `DiveModeGlyph` uses the exact spec §C21 monofin and tank paths (the glyphs on the approved canvas), not hand-drawn approximations.
- The fixed status-band offset (36 pt Ultra / 31 pt 42 mm, ignoring the top safe area) must be checked on 40/41/44/46 mm simulators and on the demo screen with its toolbar in Task 6.

## C6. Recommended-stop record rows (summary scrolled + detail page 3)
- Drop the "권장 사항" row (it only repeats "권장 스탑" and reads like a recommendation claim).
- Drop "완료 여부" (duplicates 상태).
- Show "남은 시간" only when the stop was not completed (mock data is completed → hidden).
- "구간 체류 시간" → **"스탑 구간 시간"**, value "3분".
- "목표 / 구간" → **"목표 수심 / 스탑 구간"**, value "5.0 m · 3.0–6.0 m".
- Resulting completed set: "상태" "권장 스탑 완료" (ink2, full width) · "스탑 구간 시간" "3분" · "목표 수심 / 스탑 구간" "5.0 m · 3.0–6.0 m" (full width) · "시작" "오전 10:39" | "완료 시각" "오전 10:42". The note "권장 스탑 참고 기록입니다. 안전 판단에 사용하지 마세요." stays.

## C12. Recommended-stop record note placement
"권장 스탑 참고 기록입니다. 안전 판단에 사용하지 마세요." sits directly under the section eyebrow ("권장 스탑 요약" / "권장 스탑 기록"), before the values, so it is always on screen together with them.

## C15. P6 — one term for the dive's elapsed time (owner adopted)
Scuba: "시간" / "기록 시간" / "총 기록 시간" → **"다이빙 시간"** on recording pages, stop page, End page, Always-On, summary and detail (value format unchanged: "21:40" live, "42분 10초" saved). Freedive: a single dive's "시간" → "다이빙 시간"; the session total "총 기록 시간" stays; "직전 다이빙 시간", "최장 다이빙" stay.

## 소유자 리뷰 수정 요청 (2026-10-23)

1. 수중 조작 안내의 동작 버튼 그림이 1 → 0.88 → 1로 한 번 눌렀다 떼도록 한다.
2. Wet Ready 타일과 툴바 버튼은 튕기지 않는 부드러운 누름을 쓴다.
3. 카탈로그 키 `Log time: %@`의 en을 `Dive time: %@`, ko를 `다이빙 시간: %@`로 바꾼다.
4. Home 시작은 먼저 기록 시작을 요청하고, 받아들여졌을 때만 계획·종류·대기 상태를 바꾼다. 죽은 스피너 대체 상태는 지운다.
5. 날짜·상대 날짜 formatter를 재사용하고, 저장 기록의 그래프 점은 기록별로 한 번만 계산한다. 요약의 로고 라이더는 프레임마다 배열을 만들지 않는다.
6. 그래프 점 압축은 읽을 수 없는 수심이 있는 구간을 건너뛰되 x 위치를 줄이지 않는다.
7. 종료 화면의 수중 잠금 줄은 동작 버튼이 있을 때 보이고, 없으면 숨긴다.
8. 다음 다이빙 안내 칩 정의는 하나만 둔다.
9. 시작 오류의 하단 배너가 `완료` 버튼을 가리지 않도록 배너 자리를 남긴다(실기기 흐름과 데모 흐름 모두).
10. 종료 중 화면은 기록 계기를 30 %로 남기고 그 위에 spinner와 `기록을 종료하고 있습니다.`를 페이드로 보인다.
11. 권장 스탑 기록: `상태`는 전체 폭, `스탑 구간 시간`은 자기 줄, `목표 수심 / 스탑 구간`은 전체 폭, 그 다음 `시작` | `완료 시각`(C12 참고 문장이 먼저).
12. 카탈로그에서 Swift가 아직 쓰는 키의 stale 표시를 지운다(`Debug depth control`, `Test Scuba`, `Test Freedive`, `Test Large Sync`).
13. 스쿠버 `다이빙 시간`과 프리다이빙 `총 기록 시간` 라벨은 요약과 상세가 함께 쓰는 하나의 helper로 정한다.
14. ko 카탈로그에서 `Divenary`와 조사 사이에 단어 결합 문자 U+2060을 넣는다. 문구는 바꾸지 않는다.
