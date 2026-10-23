# Copy decisions (design lead) — override spec.md copy

Decided after the copy audit against the wiki (`mobile-watch-ui-language.md` 화면 문구 / watchOS 번역) and the shipped `Localizable.xcstrings`. Apply exactly. Anything not listed keeps the spec's (shipped) wording.

## C1. Start card title
"스쿠버 다이빙" → **"스쿠버"** (one term per dive type: 프리다이빙 / 스쿠버, same as Wet Ready tiles, chips and list rows).

## C2. Sync status (repeat of DECISIONS D3)
Never "전송 대기", "iPhone 저장", "전송 실패". Home recent card + list rows: glyph only (aria-label = full term). Summary + detail: "iPhone 전송 대기" / "iPhone에 저장됨" / "iPhone 전송 실패".

## C3. One non-certified sentence everywhere
Use exactly **"다이빙 기록·복기용입니다. 인증된 다이브 컴퓨터가 아닙니다."** on Home footer, Wet Ready, the last guide page, summary (scrolled), saved list footer and detail footer. It may wrap onto two lines at the sentence break. Do not use the other variants ("다이빙 기록용입니다…", "저장한 기록의 복기용입니다…", "이 앱은 다이빙 기록·복기용이며…", "기록 복기용입니다…").

## C4. Summary save status
"저장됨" → **"워치에 저장됨"** (with the checkmark). The sync line below/near it stays "iPhone 전송 대기" — save location and send direction are separate (wiki: 저장 위치와 전송 방향을 섞지 않는다).

## C5. Send-failure note on the detail
"전송하지 못했습니다. 다시 시도하세요. (1)" → **"전송하지 못했습니다. 다시 보내 주세요."** + "(1)" in ink3 (the existing numbered retry feedback). The button stays **"다시 보내기"**.

## C6. Recommended-stop record rows (summary scrolled + detail page 3)
- Drop the "권장 사항" row (it only repeats "권장 스탑" and reads like a recommendation claim).
- Drop "완료 여부" (duplicates 상태).
- Show "남은 시간" only when the stop was not completed (mock data is completed → hidden).
- "구간 체류 시간" → **"스탑 구간 시간"**, value "3분".
- "목표 / 구간" → **"목표 수심 / 스탑 구간"**, value "5.0 m · 3.0–6.0 m".
- Resulting completed set: "상태" "권장 스탑 완료" (ink2, full width) · "스탑 구간 시간" "3분" · "목표 수심 / 스탑 구간" "5.0 m · 3.0–6.0 m" (full width) · "시작" "오전 10:39" | "완료 시각" "오전 10:42". The note "권장 스탑 참고 기록입니다. 안전 판단에 사용하지 마세요." stays.

## C7. Crown guide page
Body = the shipped sentence **"기록 중에는 디지털 크라운을 돌려 화면을 오갈 수 있습니다. 종류 바꾸기와 기록 종료는 그 화면에서 동작 버튼을 눌러야 합니다."**, then the paragraph "수면에서 수중 잠금을 해제하면 기록이 끝납니다."

## C8. Kept as shipped (no change)
- Recording labels "시간", "최대", "기록 시간", "총 기록 시간", "확인된 시간" (wiki names them for these screens; unifying to "다이빙 시간" stays proposal P6).
- Live stop completion "권장 스탑 완료" (shipped; keeps "권장").
- "평점" label with the star row (VoiceOver "5점 중 4점").
- Save-failure copy stays shipped (shorter copy stays proposal P11).

## C10. Saved logs — one term
"저장된 기록을 읽지 못했습니다." → **"저장한 기록을 읽지 못했습니다."** (same term as the Home row "저장한 기록" and the empty state "아직 저장한 기록이 없습니다").

## C11. Plan rows — shipped term for the planned depth
Not "계획 수심". Plan rows read: title / glyph + type ("스쿠버" / "프리다이빙") / **"계획 최대 수심"** (ink2) + value ("18.0" white 600 + " m" ink2) / date. Each on its own line so nothing wraps.

## C12. Recommended-stop record note placement
"권장 스탑 참고 기록입니다. 안전 판단에 사용하지 마세요." sits directly under the section eyebrow ("권장 스탑 요약" / "권장 스탑 기록"), before the values, so it is always on screen together with them.

## C13. Demo (D17)
- Home row: title "데모", detail **"기록 없이 둘러보기"** (replaces "가상 수심").
- Demo hint chip (no dots): **"크라운 ▸ 수심 바꾸기"** (chip grammar "크라운 ▸ …", replaces "디지털 크라운으로 수심 조절").

## C14. No-samples result (D17)
Title **"물속 기록이 없습니다"** (34px/600 white), body **"기록된 값이 없어 저장하지 않았습니다."** (28px/400 ink2), button "완료". Icon: `divenary.column` 64px ink2 (replaces the water.waves hero and "수심이 기록되지 않았습니다").

## C15. P6 — one term for the dive's elapsed time (owner adopted)
Scuba: "시간" / "기록 시간" / "총 기록 시간" → **"다이빙 시간"** on recording pages, stop page, End page, Always-On, summary and detail (value format unchanged: "21:40" live, "42분 10초" saved). Freedive: a single dive's "시간" → "다이빙 시간"; the session total "총 기록 시간" stays; "직전 다이빙 시간", "최장 다이빙" stay.

## C9. Canvas captions (gauge anatomy etc.)
Use the product terms: "타이머 일시정지" (not "일시정지"), "수심 측정 범위 밖" (not "범위 밖").
