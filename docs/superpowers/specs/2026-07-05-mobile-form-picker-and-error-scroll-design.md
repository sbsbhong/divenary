# Mobile Form Picker And Error Scroll Design

## Context

The mobile Logbook and Planning editors use wheel pickers for required dive metrics. Recent compound wheel changes split depth into meter, tenth, and fixed unit columns. On narrow iPhone layouts, the two-column editor rows still need to stay two columns, but the current picker presentation can clip the depth unit and adjacent scroll values. The Planning editor label `Planned Duration (MIN)` also wraps in the two-column row and looks broken.

The editors already compute the first invalid field on submit. The parent screens currently translate that field name to hardcoded scroll offsets. Those offsets are brittle because editor content, language, error height, and device width can change independently.

## Goals

- Keep the Logbook metric row and Planning metric row as two columns.
- Make depth wheels functional and readable in the narrow two-column cards.
- Keep planned duration labeling on one stable line in the two-column card.
- On `Save log` and `Set planned`, scroll to the first invalid field when validation fails.
- Preserve current form schemas, persistence behavior, and safety boundaries.

## Non-Goals

- Do not add a new picker dependency.
- Do not redesign the full Logbook or Planning editor.
- Do not change validation rules, stored data shape, or watch sync contracts.
- Do not add safety-critical dive calculations or claims.

## Design

### Picker Layout

`DepthWheelField` will keep the compound meter, tenth, and fixed meter unit model. The field will pass compact column widths that fit inside a half-width editor card. The center row and wheel rows must not depend on widths that exceed the available card width.

The fixed unit column will continue to be non-scrollable. It must remain visible in the center value row, and the surrounding scroll values must remain visible enough to make the wheel usable.

The shared `MultiColumnNumberWheelPicker` should keep its public API small. Any layout fix should be local to the component or the depth field props, not spread into screen-specific styles.

### Planned Duration Label

The Planning editor will use a shorter label for the right metric field in the two-column mode. The displayed label should communicate the same meaning without wrapping, for example `Duration (min)`. Existing i18n keys can stay intact unless a narrower string is needed in the resources.

### Invalid Submit Scroll

The editors will keep computing the first invalid field in schema order. The parent screen will stop relying on hardcoded y offsets where possible. Instead, each relevant editor field will register its layout y coordinate with the screen or a small helper, and `onInvalidSubmit(fieldName)` will scroll to that measured position with a small top margin.

Fallback offsets may remain for fields that are not yet measured, but the main path should use actual layout data. If more than one field is invalid, the existing first-field order decides the scroll target.

## Components

- `apps/mobile/src/components/ui/multi-column-number-wheel-picker.tsx`
  - Tighten center and scroll column sizing so compact compound fields do not clip.
- `apps/mobile/src/screens/common/form/compound-number-wheel-fields.tsx`
  - Apply compact depth column widths for narrow two-column cards.
- `apps/mobile/src/screens/common/form/editor-field.tsx`
  - Accept an optional `onLayout` callback and forward it to the root form control so editor screens can register field positions without manual wrapper views.
- `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
  - Register field positions and report the first invalid field as it does today.
- `apps/mobile/src/screens/planning/plan-editor.tsx`
  - Register field positions and report the first invalid field as it does today.
- `apps/mobile/src/screens/logbook/screen.tsx`
  - Scroll to measured invalid field positions.
- `apps/mobile/src/screens/planning/screen.tsx`
  - Scroll to measured invalid field positions.
- `apps/mobile/src/i18n/resources.ts`
  - Shorten the Planning duration label if needed.

## Error Handling

Validation errors remain owned by React Hook Form and the existing Zod schemas. Picker direct-input parse failures keep their current behavior: invalid direct input is rejected and the picker returns to the last valid display value.

If an invalid field has no measured y coordinate, the screen should use a conservative fallback offset instead of doing nothing.

## Testing

- Add or update picker tests so compact depth columns render the meter, tenth, and `m` unit without requiring a scroll view for the fixed unit.
- Add or update Planning tests for the shortened duration label.
- Add Logbook and Planning screen tests that press the save action on invalid forms and assert the scroll view receives a scroll request to the first invalid field.
- Run the relevant mobile Jest tests and `yarn mobile:typecheck`.
