# Mobile Home Log Plan UX Hardening Design

## Context

The mobile app already has local-first Home, Logbook, and Planning surfaces. Recent manual testing found several UX issues across these screens:

- CSV badge fields require a trailing comma or Enter for the last typed value.
- Only the first badge uses the primary blue treatment, which makes later badges look less selected.
- Focused text inputs keep the keyboard up while the user taps unrelated controls.
- List screens do not consistently expose initial loading states.
- Empty Home latest-log state falls back to placeholder values such as unknown date.
- Home conditions refresh has little visible feedback in the ready state.
- Planning has a useful draft state, but draft detail cannot be promoted directly to planned.
- Completed plans can currently create multiple log drafts.
- Planning water condition copy reads like an observed value rather than a planned expectation.

This work is UI and workflow hardening only. It does not change watch contracts, safety claims, or dive calculation behavior.

## Goals

- Keep Planning drafts as the buffer state that prevents watch delivery.
- Add a direct draft-to-planned promotion action from plan detail.
- Make completed-plan log creation one-time while the generated log still exists.
- Restore completed-plan log creation if the connected log is deleted.
- Keep Planning water condition, but label it as an expected/planned value.
- Make CSV badge entry commit naturally on blur and save, without requiring Enter.
- Use one primary badge treatment for all user-entered badges.
- Dismiss the keyboard when users move from inputs to other controls.
- Add list loading skeletons and clearer empty states where list content is absent.
- Add a Home latest-log empty state instead of unknown-date placeholder content.
- Add visible Home conditions refresh feedback in the ready state.
- Fix the freedive repetition number wheel so its number is visible.

## Non-Goals

- Do not remove the Planning draft state.
- Do not send draft plans to the watch.
- Do not add a new UI or state-management dependency.
- Do not change persisted storage formats unless required to clear stale references.
- Do not implement decompression, tissue loading, gas-switching safety, emergency decisions, or certified dive-computer claims.
- Do not add Supabase or auth behavior.

## Selected Approach

Use a focused UI hardening pass that keeps existing architecture and storage boundaries. The alternatives considered were:

1. Only patch visual symptoms. This is smaller, but leaves ambiguous Planning workflow rules.
2. Harden UI feedback and clarify Planning state transitions. This is selected because it fixes the user-facing issues while preserving the current local-first app shape.
3. Remove drafts and simplify Planning statuses. This was rejected because drafts are useful as a watch-delivery guard.

## Design

### Shared Badge And Keyboard Behavior

`BadgeListField` will commit pending text when:

- the user types a comma,
- the field submits,
- the field blurs,
- or the parent editor triggers a save.

The pending value is split with the same comma tokenizer and trimmed before being appended. Empty tokens and duplicates remain ignored. All badges in one field use the same primary chip styling, including text and remove icon color.

The editor screens will make non-input interactions dismiss the keyboard. The existing `KeyboardAwareScrollView` keeps drag dismissal, and form controls that open selectors, date/time triggers, wheel triggers, filter pills, or buttons will call `Keyboard.dismiss()` before handling the action when they are used from these form surfaces.

### List Loading And Empty States

`useDiveLogbook` and `useDivePlans` already expose `isLoading`. Root navigation will pass those flags to Home, Logbook, and Planning where relevant.

Logbook and Planning list areas will render compact skeleton rows during initial load. Existing empty cards remain for true empty results, with copy that clearly indicates no rows match the current list state.

Home will not render a latest-session summary card when there is no session. It will render a dedicated empty card that says no recent log exists and offers the existing Logbook action. The Home eyebrow currently translated as "recent watch import" will change to "recent log" so manual logs and watch logs are both represented.

### Home Conditions Refresh

`useHomeConditions` will expose an explicit refreshing/loading flag for retry requests. In ready state, the conditions card will show a small refresh action in the header. Pressing it starts a refetch, disables the action, and gives visible feedback with a loading action state. Existing ready data remains visible while the refresh is in flight to avoid a jarring card reset. Errors still use the existing unavailable/error states and retry action.

### Planning Draft Promotion

Draft plans stay in the model. They continue to block watch delivery because only `planned` plans are sent to the watch companion.

Plan detail will show a primary `Promote to plan` action when `plan.status === 'draft'`. Pressing it validates that required planned fields are present before changing the status to `planned`. If required fields are missing, the user goes to edit mode and sees the existing validation messages. A valid promotion updates `status` and `updatedAt`, then returns to detail/list with the status pill changed to planned.

`Mark completed` remains available only for planned plans. Drafts must be promoted before they can be completed.

### Completed Plan Log Creation

Completed plans can create a log only when no connected log currently exists.

The UI will hide `Create log from plan` when the plan has `convertedLogLocalId` and the Logbook still contains that log. If the connected log is missing or deleted, `Create log from plan` is shown again. This behavior is derived from both `plan.convertedLogLocalId` and the current log entries, so a stale stored log id does not permanently block the action.

### Planning Expected Water Condition

Planning keeps the water condition field. The label becomes "Expected water condition" in English and "예상 물 상태" in Korean. Stored field names and conversion behavior remain unchanged. Logbook continues to label the observed/manual value as water condition.

### Freedive Repetition Wheel Visibility

The freedive repetition target/count field uses the single-column `NumberWheelPicker`. The center display must remain visible in both display and direct-input modes. The fix will stay in shared wheel layout/text styling if the issue is generic, or in the repetition field sizing if the issue is field-specific. The wheel picker remains the input control.

## Components

- `apps/mobile/src/components/navigation/index.tsx`
  - Pass loading flags and log-entry existence context to Home, Logbook, and Planning.
  - Preserve plan-to-log save linkage.
  - Make log deletion restore completed-plan log creation when the connected log no longer exists.

- `apps/mobile/src/screens/home/screen.tsx`
  - Add latest-log empty state.
  - Rename latest-log copy.
  - Add ready-state conditions refresh action with loading feedback.

- `apps/mobile/src/conditions/use-home-conditions.ts`
  - Expose an in-flight refresh state without forcing ready content to disappear.

- `apps/mobile/src/screens/logbook/screen.tsx`
  - Accept `isLoading`.
  - Render skeleton rows for initial loading.
  - Keep empty view for true empty list/filter result.

- `apps/mobile/src/screens/planning/screen.tsx`
  - Accept `isLoading` and log existence context.
  - Render skeleton rows for initial loading.
  - Route draft promotion and completed-plan log action visibility.

- `apps/mobile/src/screens/planning/plan-detail.tsx`
  - Add draft promotion action.
  - Hide completed-plan log creation when connected log exists.
  - Avoid completing drafts directly.

- `apps/mobile/src/screens/planning/plan-editor.tsx`
  - Ensure pending badge text is committed before save.

- `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
  - Ensure pending badge text is committed before save.

- `apps/mobile/src/screens/common/form/badge-list-field.tsx`
  - Commit pending tokens on blur.
  - Expose a parent-triggered commit path for editor save.
  - Use one primary badge style.

- `apps/mobile/src/components/ui/number-wheel-picker.tsx`
  - Fix center value visibility for the repetition picker if the issue is shared.

- `apps/mobile/src/i18n/resources.ts`
  - Update Home latest-log and Planning expected-water-condition strings.
  - Add loading/empty copy required by the new states.

## Data Flow

Planning status flow:

1. New plan can be saved as `draft` or `planned`.
2. Draft detail can promote to `planned` after required planned fields are valid.
3. Only `planned` plans continue to be delivered to the watch companion.
4. Planned plans can be marked `completed`.
5. Completed plans can create one log draft if no connected log exists.
6. Saving that log stores the entry id in `convertedLogLocalId`.
7. Deleting that log makes the plan eligible for log creation again.

Home conditions flow:

1. Initial load shows a loading card.
2. Ready state displays current values and a refresh action.
3. Refresh keeps prior values visible while showing an in-flight affordance.
4. Success replaces snapshot values.
5. Failure moves to existing error/unavailable state.

Badge flow:

1. Text changes tokenize only completed comma segments.
2. Pending final segment stays in the input while typing.
3. Blur/save/submit commits the final segment.
4. Parent form save uses committed values.

## Error Handling

- Plan promotion uses the existing plan validation rules. Missing required fields do not create a planned watch-deliverable plan.
- Badge commit ignores empty tokens and duplicates.
- Home refresh failures reuse existing error copy and retry behavior.
- If the plan references a deleted log id, the UI shows `Create log from plan` again.
- If a list query fails, the screen keeps existing data where available and still avoids rendering misleading empty placeholder metrics.

## Testing

- Add badge field tests for:
  - final token commits on blur,
  - final token commits before editor save,
  - all badges use primary styling.
- Add Logbook and Planning tests for skeleton rendering while `isLoading`.
- Add Home tests for:
  - latest-log empty state,
  - "recent log" copy,
  - ready-state conditions refresh action and in-flight feedback.
- Add Planning tests for:
  - draft detail shows promote action,
  - promotion saves `status: 'planned'`,
  - completed plan hides log creation when connected log exists,
  - deleted/missing connected log restores log creation,
  - water condition label copy is expected/planned.
- Add number-wheel tests or screen tests ensuring freedive repetition value text renders visibly.
- Run focused Jest tests for Home, Logbook, Planning, badge/wheel behavior.
- Run `yarn mobile:typecheck`.

