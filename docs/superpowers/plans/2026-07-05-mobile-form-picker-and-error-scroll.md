# Mobile Form Picker And Error Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Logbook and Planning metric rows as two columns while fixing compact depth wheels, shortening the Planning duration label, and scrolling to the first invalid field after failed submits.

**Architecture:** The picker fix stays in the shared wheel components and the depth field wrapper. The invalid-submit scroll flow keeps validation in the editors, registers editor-relative field positions through layout callbacks, and lets each parent screen combine the editor y offset with the field y offset before calling `scrollTo`.

**Tech Stack:** React Native 0.85, React 19, TypeScript, React Hook Form, Zod, Jest with react-test-renderer, NativeWind/Gluestack primitives.

---

## File Structure

- Modify `apps/mobile/src/components/ui/wheel-picker-core.tsx`
  - Stop reserving a blank unit column when an option row has no unit label.
- Modify `apps/mobile/src/components/ui/multi-column-number-wheel-picker.tsx`
  - Respect explicit compact column widths without retaining default min widths or flex expansion.
- Modify `apps/mobile/src/screens/common/form/compound-number-wheel-fields.tsx`
  - Pass compact depth column widths that fit in two-column editor cards.
- Modify `apps/mobile/src/screens/common/form/editor-field.tsx`
  - Forward an optional `onLayout` callback from callers to the root form control.
- Modify `apps/mobile/src/components/ui/dive-summary-card.tsx`
  - Allow `DiveSummaryCard.Body` to receive `onLayout`.
- Modify `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
  - Register top-level invalid-field anchors and keep reporting the first invalid field.
- Modify `apps/mobile/src/screens/logbook/screen.tsx`
  - Store editor y and measured field y values, then scroll to the first invalid field.
- Modify `apps/mobile/src/screens/planning/plan-editor.tsx`
  - Register top-level invalid-field anchors and keep reporting the first invalid field.
- Modify `apps/mobile/src/screens/planning/plan-mode-fields.tsx`
  - Use the shorter Planning duration label in the two-column metric row.
- Modify `apps/mobile/src/screens/planning/screen.tsx`
  - Store editor y and measured field y values, then scroll to the first invalid field.
- Modify `apps/mobile/src/i18n/resources.ts`
  - Add or update a short duration label for the Planning metric row.
- Modify `apps/mobile/__tests__/number-wheel-picker.test.tsx`
  - Cover compact depth wheel layout and no blank fixed-unit scroll column.
- Modify `apps/mobile/__tests__/planning-screen.test.tsx`
  - Cover the short duration label and invalid-submit scroll.
- Modify `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
  - Cover invalid-submit scroll.

## Task 1: Picker Regression Tests

**Files:**
- Modify: `apps/mobile/__tests__/number-wheel-picker.test.tsx`

- [ ] **Step 1: Add a failing test for compact fixed-width multi-column rows**

Add this test near the existing `renders fixed columns in the shared center row without a scroll view` test:

```tsx
  it('honors explicit compact column widths without reserving blank unit space', async () => {
    const onColumnChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <MultiColumnNumberWheelPicker
          columns={[
            { id: 'meters', value: 19, min: 0, max: 60, step: 1, width: 54 },
            { id: 'tenths', value: 6, min: 0, max: 9, step: 1, width: 44, formatValue: value => `.${value}` },
            { id: 'unit', fixedLabel: 'm', width: 22 },
          ]}
          onColumnChange={onColumnChange}
          directInput={{
            value: '19.6',
            normalize: value => value,
            onCommit: () => false,
            keyboardType: 'decimal-pad',
          }}
          testID="depth-picker"
        />,
      );
    });
    renderers.push(renderer!);

    const metersList = renderer!.root.findByProps({ testID: 'depth-picker-column-meters-wheel-list' });
    const tenthsList = renderer!.root.findByProps({ testID: 'depth-picker-column-tenths-wheel-list' });
    const fixedUnitColumn = renderer!.root.findByProps({ testID: 'depth-picker-column-unit' });

    expect(metersList.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 54 })]));
    expect(tenthsList.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 44 })]));
    expect(fixedUnitColumn.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 22 })]));
    expect(renderer!.root.findByProps({ testID: 'depth-picker-option-18-value' }).props.children).toBe('18');
    expect(renderer!.root.findAllByProps({ testID: 'depth-picker-option-18-unit-column' })).toHaveLength(0);
    expect(renderer!.root.findByProps({ testID: 'depth-picker-meters-value' }).props.children).toBe('19');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-tenths-value' }).props.children).toBe('.6');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-unit-fixed' }).props.children).toBe('m');
  });
```

- [ ] **Step 2: Run the focused picker test and verify it fails**

Run: `yarn workspace @repo/mobile test -- number-wheel-picker.test.tsx --runInBand`

Expected before implementation: FAIL because fixed-width styles still include default min width/flex behavior and blank unit columns are still rendered.

## Task 2: Picker Layout Implementation

**Files:**
- Modify: `apps/mobile/src/components/ui/wheel-picker-core.tsx`
- Modify: `apps/mobile/src/components/ui/multi-column-number-wheel-picker.tsx`
- Modify: `apps/mobile/src/screens/common/form/compound-number-wheel-fields.tsx`

- [ ] **Step 1: Remove blank unit-column reservation for unitless option rows**

In `WheelOptionContent`, render the unit column only when `props.unitLabel` is present:

```tsx
      {props.unitLabel ? (
        <Box testID={`${props.testIDPrefix}-unit-column`} style={[coreStyles.unitColumn, props.unitColumnStyle]} className="items-start justify-center">
          <Text
            testID={`${props.testIDPrefix}-unit`}
            numberOfLines={1}
            className={`${props.unitClassName ?? presentation.unitClassName}${centerHiddenClassName}`}
          >
            {props.unitLabel}
          </Text>
        </Box>
      ) : null}
```

- [ ] **Step 2: Respect explicit widths in multi-column scroll and center columns**

In `MultiColumnWheelColumn`, use non-flex style when `props.column.width` is set:

```tsx
      style={[
        props.column.width === undefined ? styles.scroller : styles.fixedWidthScroller,
        props.column.width === undefined ? null : { width: props.column.width },
        { height: props.layout.wheelHeight },
      ]}
```

In fixed columns and center columns, use only the explicit width when one is provided:

```tsx
style={column.width === undefined ? styles.fixedColumn : { width: column.width }}
```

```tsx
style={props.column.width === undefined ? styles.centerColumn : { width: props.column.width }}
```

```tsx
style={column.width === undefined ? styles.fixedCenterColumn : { width: column.width }}
```

Add this style:

```tsx
  fixedWidthScroller: {},
```

- [ ] **Step 3: Compact depth column widths**

In `DepthWheelField`, use these compact widths:

```tsx
          { id: 'meters', value: meters, min: 0, max: maxMetersInteger, step: 1, width: 54 },
          {
            id: 'tenths',
            value: Math.min(tenths, maxTenthsForMeter),
            min: 0,
            max: maxTenthsForMeter,
            step: 1,
            width: 44,
            formatValue: value => `.${value}`,
          },
          { id: 'unit', fixedLabel: 'm', width: 22 },
```

- [ ] **Step 4: Run the focused picker test and verify it passes**

Run: `yarn workspace @repo/mobile test -- number-wheel-picker.test.tsx --runInBand`

Expected after implementation: PASS.

## Task 3: Planning Duration Label Test And Implementation

**Files:**
- Modify: `apps/mobile/__tests__/planning-screen.test.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Modify: `apps/mobile/src/screens/planning/plan-mode-fields.tsx`

- [ ] **Step 1: Add a failing test for the short metric label**

In `renders date time as a row trigger and numeric values as wheel pickers`, add:

```tsx
    expect(root.findByProps({ testID: 'planning-editor-planned-duration-label' }).props.children).toBe('Duration (min)');
```

- [ ] **Step 2: Run the focused planning test and verify it fails**

Run: `yarn workspace @repo/mobile test -- planning-screen.test.tsx --runInBand`

Expected before implementation: FAIL because the label testID does not exist or the label is still `Planned duration (min)`.

- [ ] **Step 3: Expose a label testID and use the shorter label**

Extend `EditorFieldProps`:

```tsx
  labelTestID?: string;
```

Pass it to `FormControlLabelText`:

```tsx
<FormControlLabelText testID={props.labelTestID} className="text-xs font-semibold uppercase text-muted-foreground">
```

In `NumericSliderFieldProps`, add:

```tsx
  labelTestID?: string;
```

Pass it to `EditorField`.

In `PlanModeFields`, change the planned duration field to:

```tsx
              label={t('planning.durationMinutesShort', { defaultValue: 'Duration (min)' })}
              labelTestID="planning-editor-planned-duration-label"
```

Add i18n resources:

```ts
durationMinutesShort: '시간(분)',
durationMinutesShort: 'Duration (min)',
```

- [ ] **Step 4: Run the focused planning test and verify it passes**

Run: `yarn workspace @repo/mobile test -- planning-screen.test.tsx --runInBand`

Expected after implementation: PASS.

## Task 4: Invalid Submit Scroll Tests

**Files:**
- Modify: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- Modify: `apps/mobile/__tests__/planning-screen.test.tsx`

- [ ] **Step 1: Add Logbook screen scroll test**

Add a test near `manual editor reports the first invalid field so the screen can scroll to it`:

```tsx
  test('manual editor scrolls to the first invalid field on failed save', async () => {
    const renderer = await renderLogbook(new LocalDiveLogRepository([]));
    const root = renderer.root;

    await press(root, 'logbook-create-action');
    root.findByProps({ testID: 'log-entry-editor-card-anchor' }).props.onLayout({ nativeEvent: { layout: { y: 180 } } });
    root.findByProps({ testID: 'log-entry-editor-body' }).props.onLayout({ nativeEvent: { layout: { y: 96 } } });
    root.findByProps({ testID: 'log-entry-editor-site-name-anchor' }).props.onLayout({ nativeEvent: { layout: { y: 210 } } });
    await press(root, 'log-entry-editor-save');

    expect(root.findByProps({ testID: 'logbook-scroll-target' }).props.children).toBe('470');
  });
```

- [ ] **Step 2: Add Planning screen scroll test**

Add a test near `plan editor reports the first invalid field so the screen can scroll to it`:

```tsx
  it('plan editor scrolls to the first invalid field on failed set planned', async () => {
    const renderer = await renderPlanning(new LocalDivePlanRepository([]));
    const root = renderer.root;

    await press(root, 'planning-create-action');
    root.findByProps({ testID: 'planning-editor-card-anchor' }).props.onLayout({ nativeEvent: { layout: { y: 160 } } });
    root.findByProps({ testID: 'planning-editor-body' }).props.onLayout({ nativeEvent: { layout: { y: 94 } } });
    root.findByProps({ testID: 'planning-editor-planned-at-anchor' }).props.onLayout({ nativeEvent: { layout: { y: 80 } } });
    await press(root, 'planning-editor-save-planned');

    expect(root.findByProps({ testID: 'planning-scroll-target' }).props.children).toBe('318');
  });
```

- [ ] **Step 3: Run focused screen tests and verify they fail**

Run: `yarn workspace @repo/mobile test -- logbook-manual-entry.test.tsx planning-screen.test.tsx --runInBand`

Expected before implementation: FAIL because anchor testIDs and scroll-target probes do not exist.

## Task 5: Invalid Submit Scroll Implementation

**Files:**
- Modify: `apps/mobile/src/components/ui/dive-summary-card.tsx`
- Modify: `apps/mobile/src/screens/common/form/editor-field.tsx`
- Modify: `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/planning/plan-editor.tsx`
- Modify: `apps/mobile/src/screens/planning/screen.tsx`

- [ ] **Step 1: Add layout pass-through props**

In `DiveSummaryCardBody`, change the signature to:

```tsx
function DiveSummaryCardBody(props: { children?: React.ReactNode; onLayout?: React.ComponentProps<typeof VStack>['onLayout']; testID?: string }): React.JSX.Element {
  return <VStack testID={props.testID} onLayout={props.onLayout} space="md">{props.children}</VStack>;
}
```

In `EditorFieldProps`, add:

```tsx
  onLayout?: React.ComponentProps<typeof FormControl>['onLayout'];
  testID?: string;
```

Pass them to `FormControl`:

```tsx
<FormControl testID={props.testID} onLayout={props.onLayout} isInvalid={Boolean(props.error)} className={props.className}>
```

- [ ] **Step 2: Register measured offsets in LogEntryEditor**

Add props:

```tsx
  onFieldLayout?: (fieldName: string, y: number) => void;
  onBodyLayout?: (y: number) => void;
```

Add local helpers:

```tsx
  const bodyOffsetRef = React.useRef(0);
  const registerBodyLayout = React.useCallback(
    (event: { nativeEvent: { layout: { y: number } } }) => {
      bodyOffsetRef.current = event.nativeEvent.layout.y;
      props.onBodyLayout?.(event.nativeEvent.layout.y);
    },
    [props],
  );
  const registerFieldLayout = React.useCallback(
    (fieldName: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
      props.onFieldLayout?.(fieldName, bodyOffsetRef.current + event.nativeEvent.layout.y);
    },
    [props],
  );
  const registerFieldGroupLayout = React.useCallback(
    (fieldNames: string[]) => (event: { nativeEvent: { layout: { y: number } } }) => {
      const y = bodyOffsetRef.current + event.nativeEvent.layout.y;
      fieldNames.forEach(fieldName => props.onFieldLayout?.(fieldName, y));
    },
    [props],
  );
```

Wrap the card in a screen-level anchor in `LogbookScreen`, and use `DiveSummaryCard.Body testID="log-entry-editor-body" onLayout={registerBodyLayout}`. Add `testID`/`onLayout` to `siteName`, and add `onLayout={registerFieldGroupLayout(['durationSeconds', 'maxDepthMeters'])}` to the metric `HStack`.

- [ ] **Step 3: Register measured offsets in PlanEditor**

Use the same helper pattern. Add `DiveSummaryCard.Body testID="planning-editor-body" onLayout={registerBodyLayout}`. Register `plannedAt`, `siteName`, and the `PlanModeFields` section for `plannedMaxDepthMeters` and `plannedDurationMinutes`.

- [ ] **Step 4: Scroll from screens using editor y plus field y**

In both screens, add refs and a debug probe state:

```tsx
  const editorOffsetRef = React.useRef(0);
  const editorFieldOffsetsRef = React.useRef<Record<string, number>>({});
  const [lastScrollTarget, setLastScrollTarget] = React.useState<number | undefined>();
```

Add helpers:

```tsx
  const registerEditorOffset = React.useCallback((event: { nativeEvent: { layout: { y: number } } }) => {
    editorOffsetRef.current = event.nativeEvent.layout.y;
  }, []);

  const registerEditorFieldOffset = React.useCallback((fieldName: string, y: number) => {
    editorFieldOffsetsRef.current = {
      ...editorFieldOffsetsRef.current,
      [fieldName]: y,
    };
  }, []);
```

Change invalid scroll to use measured offsets first:

```tsx
  const scrollToEditorError = React.useCallback((fieldName: string) => {
    const measuredFieldOffset = editorFieldOffsetsRef.current[fieldName];
    const fallbackOffset = getLogEntryEditorFieldOffset(fieldName);
    const nextOffset = Math.max(0, measuredFieldOffset === undefined ? fallbackOffset : editorOffsetRef.current + measuredFieldOffset - 16);
    setLastScrollTarget(nextOffset);
    scrollViewRef.current?.scrollTo({ y: nextOffset, animated: true });
  }, []);
```

Use `getPlanEditorFieldOffset` in Planning. Render hidden test probes:

```tsx
{lastScrollTarget === undefined ? null : <Text testID="logbook-scroll-target" className="hidden">{`${lastScrollTarget}`}</Text>}
```

and:

```tsx
{lastScrollTarget === undefined ? null : <Text testID="planning-scroll-target" className="hidden">{`${lastScrollTarget}`}</Text>}
```

Wrap each editor with a `Box` anchor:

```tsx
<Box testID="log-entry-editor-card-anchor" onLayout={registerEditorOffset}>
  <LogEntryEditor onFieldLayout={registerEditorFieldOffset} ... />
</Box>
```

and:

```tsx
<Box testID="planning-editor-card-anchor" onLayout={registerEditorOffset}>
  <PlanEditor onFieldLayout={registerEditorFieldOffset} ... />
</Box>
```

- [ ] **Step 5: Fix the Logbook fallback key**

In `getLogEntryEditorFieldOffset`, replace `durationMinutes` with `durationSeconds`.

- [ ] **Step 6: Run focused screen tests and verify they pass**

Run: `yarn workspace @repo/mobile test -- logbook-manual-entry.test.tsx planning-screen.test.tsx --runInBand`

Expected after implementation: PASS.

## Task 6: Final Verification

**Files:**
- All modified files above.

- [ ] **Step 1: Run all focused tests**

Run:

```bash
yarn workspace @repo/mobile test -- number-wheel-picker.test.tsx logbook-manual-entry.test.tsx planning-screen.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- apps/mobile/src/components/ui/wheel-picker-core.tsx apps/mobile/src/components/ui/multi-column-number-wheel-picker.tsx apps/mobile/src/screens/common/form/compound-number-wheel-fields.tsx apps/mobile/src/screens/logbook/screen.tsx apps/mobile/src/screens/planning/screen.tsx
```

Expected: Only picker layout, label, invalid-scroll, and tests changed.

