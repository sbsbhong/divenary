# Mobile Home Log Plan UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Home, Logbook, and Planning UX for CSV badges, keyboard dismissal, loading/empty states, Home refresh feedback, and plan-to-log workflow rules.

**Architecture:** Keep the existing React Native, React Query, React Hook Form, and local repository boundaries. Add small props and helpers at existing screen/component seams rather than introducing new global state. Planning remains local-first: `draft` prevents watch delivery, `planned` is watch-deliverable, and completed-plan log creation is derived from both plan linkage and current log existence.

**Tech Stack:** React Native 0.85, React 19, TypeScript, React Hook Form, Zod, React Query, Jest, react-test-renderer, Gluestack UI v4 primitives.

---

## File Structure

- Modify `apps/mobile/src/screens/common/form/badge-list-field.tsx`
  - Forward a `BadgeListFieldHandle` ref with `commitPending()`.
  - Commit pending comma-separated text on blur.
  - Use one primary badge style.
- Modify `apps/mobile/src/components/ui/pressable/index.tsx`
  - Dismiss the keyboard before custom `Pressable` `onPress` handlers.
- Modify `apps/mobile/src/components/ui/number-wheel-picker.tsx`
  - Center single-column values when there is no unit label so freedive repetition values are visible.
- Modify `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
  - Flush pending badge refs before submit.
- Modify `apps/mobile/src/screens/planning/plan-editor.tsx`
  - Flush pending badge refs before draft/planned submit.
- Modify `apps/mobile/src/conditions/use-home-conditions.ts`
  - Expose `isRefreshing` while keeping ready values visible during retry.
- Modify `apps/mobile/src/screens/home/screen.tsx`
  - Add latest-log loading and empty states.
  - Add ready-state conditions refresh action with visible loading feedback.
- Modify `apps/mobile/src/screens/logbook/screen.tsx`
  - Accept `isLoading` and render skeleton rows.
- Modify `apps/mobile/src/screens/planning/screen.tsx`
  - Accept `isLoading` and `logEntryIds`.
  - Route draft promotion and completed-plan log availability.
- Modify `apps/mobile/src/screens/planning/plan-detail.tsx`
  - Add draft promotion action.
  - Hide completed-plan log action while linked log exists.
  - Prevent completing drafts directly.
- Modify `apps/mobile/src/components/navigation/index.tsx`
  - Pass loading flags and log ids through navigation routes.
- Modify `apps/mobile/src/i18n/resources.ts`
  - Update Home latest-log copy.
  - Add latest-log empty/loading copy.
  - Add Home conditions refresh copy.
  - Rename Planning water condition to expected water condition.
  - Add draft promotion copy.
- Test `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- Test `apps/mobile/__tests__/planning-screen.test.tsx`
- Test `apps/mobile/__tests__/home-conditions.test.tsx`
- Test `apps/mobile/__tests__/number-wheel-picker.test.tsx`

---

### Task 1: Shared CSV Badge, Keyboard, And Wheel Behavior

**Files:**
- Modify: `apps/mobile/src/screens/common/form/badge-list-field.tsx`
- Modify: `apps/mobile/src/components/ui/pressable/index.tsx`
- Modify: `apps/mobile/src/components/ui/number-wheel-picker.tsx`
- Modify: `apps/mobile/src/screens/logbook/log-entry-editor.tsx`
- Modify: `apps/mobile/src/screens/planning/plan-editor.tsx`
- Test: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- Test: `apps/mobile/__tests__/planning-screen.test.tsx`
- Test: `apps/mobile/__tests__/number-wheel-picker.test.tsx`

- [ ] **Step 1: Add failing Logbook badge tests**

Add tests near the existing badge/manual-entry tests in `apps/mobile/__tests__/logbook-manual-entry.test.tsx`.

```tsx
test('commits the final comma-separated badge token before saving', async () => {
  const repository = new LocalDiveLogRepository([], { now: () => 1781354000 });
  const renderer = await renderLogbook(repository);
  const root = renderer.root;

  await press(root, 'logbook-create-action');
  await changeDateTime(root, 'log-entry-editor-started-at', new Date('2026-06-20T09:30:00'));
  await changeText(root, 'log-entry-editor-site-name', 'Badge Save Reef');
  await changeNumber(root, 'log-entry-editor-duration', 45 * 60);
  await changeNumber(root, 'log-entry-editor-max-depth', 18);
  await changeText(root, 'log-entry-editor-buddies-input', 'Mina, Alex');
  await press(root, 'log-entry-editor-save');

  const [savedEntry] = await repository.list();
  expect(savedEntry.manual.buddyIds).toEqual(['Mina', 'Alex']);
});

test('commits the final badge token on blur and styles every badge as primary', async () => {
  const repository = new LocalDiveLogRepository([], { now: () => 1781354000 });
  const renderer = await renderLogbook(repository);
  const root = renderer.root;

  await press(root, 'logbook-create-action');
  await changeText(root, 'log-entry-editor-tags-input', 'reef, training');

  await ReactTestRenderer.act(async () => {
    root.findByProps({ testID: 'log-entry-editor-tags-input' }).props.onBlur();
  });

  expect(root.findByProps({ testID: 'log-entry-editor-tags-badge-reef' }).props.className).toEqual(
    expect.stringContaining('bg-primary/10'),
  );
  expect(root.findByProps({ testID: 'log-entry-editor-tags-badge-training' }).props.className).toEqual(
    expect.stringContaining('bg-primary/10'),
  );
});
```

- [ ] **Step 2: Add failing Planning badge and wheel tests**

Add to `apps/mobile/__tests__/planning-screen.test.tsx`:

```tsx
it('commits the final plan badge token before saving', async () => {
  const repository = new LocalDivePlanRepository([], { now: () => 1781354000 });
  const renderer = await renderPlanning(repository);
  const root = renderer.root;

  await press(root, 'planning-create-action');
  await changeDateTime(root, 'planning-editor-planned-at', new Date('2026-06-20T09:30:00'));
  await changeText(root, 'planning-editor-site-name', 'Plan Badge Reef');
  await changeNumber(root, 'planning-editor-planned-max-depth', 20);
  await changeNumber(root, 'planning-editor-planned-duration', 40);
  await changeText(root, 'planning-editor-tags-input', 'reef, line');
  await press(root, 'planning-editor-save-planned');

  const [savedPlan] = await repository.list();
  expect(savedPlan.tags).toEqual(['reef', 'line']);
});
```

Add to `apps/mobile/__tests__/number-wheel-picker.test.tsx`:

```tsx
test('centers a unitless single-column value for repetition fields', async () => {
  const onChange = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <NumberWheelPicker value={8} min={0} max={200} step={1} onChange={onChange} testID="repetition-picker" />,
    );
  });
  renderers.push(renderer!);

  const value = renderer!.root.findByProps({ testID: 'repetition-picker-value' });
  const valueColumn = renderer!.root.findByProps({ testID: 'repetition-picker-center-value-column' });

  expect(value.props.children).toBe('8');
  expect(value.props.className).toEqual(expect.stringContaining('text-center'));
  expect(valueColumn.props.className).toEqual(expect.stringContaining('items-center'));
});
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```bash
yarn workspace @repo/mobile test --runTestsByPath apps/mobile/__tests__/logbook-manual-entry.test.tsx apps/mobile/__tests__/planning-screen.test.tsx apps/mobile/__tests__/number-wheel-picker.test.tsx --runInBand
```

Expected: FAIL. Failures should reference missing final-token commit behavior and unitless wheel centering.

- [ ] **Step 4: Implement `BadgeListField` ref, blur commit, and primary styling**

In `apps/mobile/src/screens/common/form/badge-list-field.tsx`, export a handle type and forward the ref:

```tsx
export type BadgeListFieldHandle = {
  commitPending: () => string[];
};

export const BadgeListField = React.forwardRef<BadgeListFieldHandle, BadgeListFieldProps>(
  function BadgeListField(props, ref): React.JSX.Element {
    const [pendingValue, setPendingValue] = React.useState('');
    const pendingValueRef = React.useRef('');

    const commitTokens = React.useCallback(
      (tokens: string[], options: { clearPending?: boolean } = {}) => {
        const nextValues = [...props.values];

        for (const token of tokens) {
          const normalizedToken = token.trim();
          if (normalizedToken.length && !nextValues.includes(normalizedToken)) {
            nextValues.push(normalizedToken);
          }
        }

        if (options.clearPending) {
          pendingValueRef.current = '';
          setPendingValue('');
        }

        props.onChange(nextValues);
        return nextValues;
      },
      [props],
    );

    const commitPending = React.useCallback(() => {
      return commitTokens([pendingValueRef.current], { clearPending: true });
    }, [commitTokens]);

    React.useImperativeHandle(ref, () => ({ commitPending }), [commitPending]);
```

Keep `pendingValueRef.current` in sync in `handleChangeText`:

```tsx
if (!text.includes(',')) {
  pendingValueRef.current = text;
  setPendingValue(text);
  return;
}

const parts = text.split(',');
commitTokens(parts.slice(0, -1));
const nextPendingValue = parts[parts.length - 1] ?? '';
pendingValueRef.current = nextPendingValue;
setPendingValue(nextPendingValue);
```

Add `onBlur={commitPending}` and use one style for every badge:

```tsx
const badgeTone = primaryBadgeTone;
```

Replace `getBadgeTone` with:

```tsx
const primaryBadgeTone = {
  container: 'border-primary/20 bg-primary/10',
  text: 'text-primary',
};
```

- [ ] **Step 5: Flush badge refs before Logbook editor save**

In `apps/mobile/src/screens/logbook/log-entry-editor.tsx`, import `Keyboard` and the handle type:

```tsx
import { Keyboard, type LayoutChangeEvent } from 'react-native';
import { BadgeListField, type BadgeListFieldHandle } from '../common/form/badge-list-field';
```

Add refs:

```tsx
const buddiesRef = React.useRef<BadgeListFieldHandle>(null);
const tagsRef = React.useRef<BadgeListFieldHandle>(null);
const marineLifeRef = React.useRef<BadgeListFieldHandle>(null);
```

Add a flush helper:

```tsx
const flushPendingBadgeFields = React.useCallback(() => {
  form.setValue('buddies', buddiesRef.current?.commitPending() ?? form.getValues('buddies'), { shouldDirty: true });
  form.setValue('tags', tagsRef.current?.commitPending() ?? form.getValues('tags'), { shouldDirty: true });
  form.setValue('observedMarineLife', marineLifeRef.current?.commitPending() ?? form.getValues('observedMarineLife'), { shouldDirty: true });
}, [form]);
```

Wrap save:

```tsx
const save = React.useCallback(() => {
  Keyboard.dismiss();
  flushPendingBadgeFields();
  void form.handleSubmit(async values => {
    setLocalSaveFailed(false);
    try {
      await props.onSave(logEntryFormValuesToEntry(props.entry, values, form.formState.dirtyFields as LogEntryDirtyFields));
    } catch {
      setLocalSaveFailed(true);
    }
  }, handleInvalidSubmit)();
}, [flushPendingBadgeFields, form, handleInvalidSubmit, props]);
```

Pass refs to the three fields:

```tsx
<BadgeListField ref={buddiesRef} ... />
<BadgeListField ref={tagsRef} ... />
<BadgeListField ref={marineLifeRef} ... />
```

- [ ] **Step 6: Flush badge refs before Planning editor save**

In `apps/mobile/src/screens/planning/plan-editor.tsx`, import `Keyboard` and the handle type:

```tsx
import { Keyboard, type LayoutChangeEvent } from 'react-native';
import { BadgeListField, type BadgeListFieldHandle } from '../common/form/badge-list-field';
```

Add refs and flush helper:

```tsx
const buddiesRef = React.useRef<BadgeListFieldHandle>(null);
const gearIdsRef = React.useRef<BadgeListFieldHandle>(null);
const tagsRef = React.useRef<BadgeListFieldHandle>(null);

const flushPendingBadgeFields = React.useCallback(() => {
  form.setValue('buddies', buddiesRef.current?.commitPending() ?? form.getValues('buddies'), { shouldDirty: true });
  form.setValue('gearIds', gearIdsRef.current?.commitPending() ?? form.getValues('gearIds'), { shouldDirty: true });
  form.setValue('tags', tagsRef.current?.commitPending() ?? form.getValues('tags'), { shouldDirty: true });
}, [form]);
```

Update `save(status)` to call `Keyboard.dismiss()` and `flushPendingBadgeFields()` before `form.handleSubmit(...)()`. Pass refs to the three `BadgeListField` instances.

- [ ] **Step 7: Dismiss keyboard for non-input pressables**

In `apps/mobile/src/components/ui/pressable/index.tsx`, import `Keyboard`:

```tsx
import { Keyboard, Pressable as RNPressable } from 'react-native';
```

Wrap `onPress` in the exported `Pressable`:

```tsx
const Pressable = React.forwardRef<React.ComponentRef<typeof UIPressable>, IPressableProps>(
  function Pressable({ className, onPress, ...props }, ref) {
    const handlePress = React.useCallback<NonNullable<IPressableProps['onPress']>>(
      event => {
        Keyboard.dismiss();
        onPress?.(event);
      },
      [onPress],
    );

    return (
      <UIPressable
        {...props}
        onPress={onPress ? handlePress : undefined}
        ref={ref}
        className={pressableStyle({ class: className })}
      />
    );
  },
);
```

- [ ] **Step 8: Center unitless single-column wheel values**

In `NumberWheelPickerCenterInputTrigger`, compute a unitless class/style:

```tsx
const valueColumnStyle = unitLabel ? styles.valueColumn : styles.singleValueColumn;
const valueColumnClassName = unitLabel ? 'items-end justify-center' : 'items-center justify-center';
const valueTextClassName = unitLabel ? 'text-2xl font-semibold text-foreground' : 'text-center text-2xl font-semibold text-foreground';
```

Use these for both editing and display modes. Add style:

```tsx
singleValueColumn: {
  flex: 1,
  paddingRight: 0,
},
```

- [ ] **Step 9: Run focused tests and commit Task 1**

Run:

```bash
yarn workspace @repo/mobile test --runTestsByPath apps/mobile/__tests__/logbook-manual-entry.test.tsx apps/mobile/__tests__/planning-screen.test.tsx apps/mobile/__tests__/number-wheel-picker.test.tsx --runInBand
```

Expected: PASS for the added and existing tests in those files.

Commit:

```bash
git add apps/mobile/src/screens/common/form/badge-list-field.tsx apps/mobile/src/components/ui/pressable/index.tsx apps/mobile/src/components/ui/number-wheel-picker.tsx apps/mobile/src/screens/logbook/log-entry-editor.tsx apps/mobile/src/screens/planning/plan-editor.tsx apps/mobile/__tests__/logbook-manual-entry.test.tsx apps/mobile/__tests__/planning-screen.test.tsx apps/mobile/__tests__/number-wheel-picker.test.tsx
git commit -m "fix: harden form badge and picker interactions"
```

---

### Task 2: Home Empty, Loading, And Conditions Refresh Feedback

**Files:**
- Modify: `apps/mobile/src/conditions/use-home-conditions.ts`
- Modify: `apps/mobile/src/screens/home/screen.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Test: `apps/mobile/__tests__/home-conditions.test.tsx`

- [ ] **Step 1: Add failing Home tests**

In `apps/mobile/__tests__/home-conditions.test.tsx`, update `renderHome` to accept `sessions` and `isLoading`:

```tsx
sessions?: React.ComponentProps<typeof HomeScreen>['sessions'];
isLoading?: boolean;
```

Pass them to `HomeScreen`.

Add tests:

```tsx
it('shows a latest log empty state instead of unknown latest metrics', async () => {
  const { renderer } = await renderHome({
    status: 'ready',
    cityName: 'Jeju City',
    localTime: 1782444600,
    airTemperatureCelsius: 24.2,
    source: 'mock',
    updatedAt: 1782444300,
  });
  const root = renderer.root;

  expect(root.findByProps({ testID: 'home-latest-empty-state' })).toBeTruthy();
  expect(root.findAllByProps({ testID: 'home-latest-date' })).toHaveLength(0);
});

it('shows a latest log skeleton while logbook data is loading', async () => {
  const { renderer } = await renderHome({
    status: 'ready',
    cityName: 'Jeju City',
    localTime: 1782444600,
    airTemperatureCelsius: 24.2,
    source: 'mock',
    updatedAt: 1782444300,
  }, { isLoading: true });

  expect(renderer.root.findByProps({ testID: 'home-latest-loading-state' })).toBeTruthy();
});

it('refreshes ready conditions with visible in-flight feedback', async () => {
  const provider: HomeConditionsProvider = {
    getCurrentConditions: jest.fn()
      .mockResolvedValueOnce({
        status: 'ready',
        cityName: 'Jeju City',
        localTime: 1782444600,
        airTemperatureCelsius: 24.2,
        source: 'mock',
        updatedAt: 1782444300,
      })
      .mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({
        status: 'ready',
        cityName: 'Busan',
        localTime: 1782448200,
        airTemperatureCelsius: 25.1,
        source: 'mock',
        updatedAt: 1782448200,
      }), 10))),
  };
  const locationService = createGrantedLocationService();
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <AppPreferencesProvider>
        <HomeScreen
          sessions={[]}
          conditionsProvider={provider}
          locationService={locationService}
          onOpenLogbook={jest.fn()}
          onOpenPlanning={jest.fn()}
          onRefresh={jest.fn()}
        />
      </AppPreferencesProvider>,
    );
    mountedRenderers.push(renderer);
    await flushPromises();
    await flushPromises();
  });

  await ReactTestRenderer.act(async () => {
    renderer!.root.findByProps({ testID: 'home-conditions-refresh-action' }).props.onPress();
  });

  expect(renderer!.root.findByProps({ testID: 'home-conditions-refreshing' })).toBeTruthy();
});
```

- [ ] **Step 2: Run Home tests and verify failure**

Run:

```bash
yarn workspace @repo/mobile test --runTestsByPath apps/mobile/__tests__/home-conditions.test.tsx --runInBand
```

Expected: FAIL because new test IDs and refresh controller state do not exist yet.

- [ ] **Step 3: Add refresh state to `useHomeConditions`**

In `apps/mobile/src/conditions/use-home-conditions.ts`, extend the controller:

```ts
export type HomeConditionsController = {
  snapshot: HomeConditionsSnapshot;
  isRefreshing: boolean;
  retry: () => void;
  openSettings: () => Promise<void>;
};
```

Add state:

```ts
const [isRefreshing, setIsRefreshing] = React.useState(false);
```

Update `loadConditions`:

```ts
const loadConditions = React.useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
  const currentRequestId = requestId.current + 1;
  requestId.current = currentRequestId;
  const isRefresh = mode === 'refresh' && snapshot.status === 'ready';

  if (isRefresh) {
    setIsRefreshing(true);
  } else {
    setSnapshot({ status: 'loading' });
  }

  try {
    // keep the existing location and provider logic here
  } finally {
    if (requestId.current === currentRequestId) {
      setIsRefreshing(false);
    }
  }
}, [locationService, options.conditionsProvider, options.locale, snapshot.status]);
```

Make `retry` call `loadConditions('refresh')` and return `isRefreshing` from the hook.

- [ ] **Step 4: Add Home latest loading and empty cards**

In `apps/mobile/src/screens/home/screen.tsx`, add `isLoading?: boolean` to props and import `Skeleton`, `SkeletonText`, and `RepeatIcon` already exists.

Replace the latest card block with:

```tsx
{props.isLoading ? (
  <LatestLogLoadingCard />
) : recentSession ? (
  <LatestLogCard
    session={recentSession}
    locale={locale}
    syncStatus={syncStatus}
    recentMaxDepthMeters={recentMaxDepthMeters}
    recentDurationSeconds={recentDurationSeconds}
  />
) : (
  <LatestLogEmptyCard onOpenLogbook={props.onOpenLogbook} />
)}
```

Add `LatestLogLoadingCard`, `LatestLogEmptyCard`, and move current latest card body into `LatestLogCard`. The empty card must include:

```tsx
<VStack testID="home-latest-empty-state" space="md">
  <DiveSummaryCard.Header eyebrow={t('home.latestLog')} title={t('home.noRecentLog')} />
  <Text className="text-sm leading-5 text-muted-foreground">{t('home.noRecentLogBody')}</Text>
</VStack>
```

The loading card must include `testID="home-latest-loading-state"`.

- [ ] **Step 5: Add ready-state Home conditions refresh action**

Pass `isRefreshing={conditionsController.isRefreshing}` to `HomeConditionsBand`.

Extend props:

```tsx
isRefreshing: boolean;
```

In the ready branch header, replace the right `StatusPill` with an `HStack` containing the source pill and an `InstrumentButton`:

```tsx
<HStack space="xs" className="items-center">
  <StatusPill label={t(`home.conditions.sources.${snapshot.source ?? 'mock'}`)} tone="secondary" />
  <InstrumentButton
    testID="home-conditions-refresh-action"
    label={props.isRefreshing ? t('home.conditions.refreshing') : t('home.conditions.refresh')}
    icon={RepeatIcon}
    disabled={props.isRefreshing}
    className="min-h-9 px-3 py-1"
    onPress={props.onRetry}
  />
</HStack>
```

Add a hidden or visible state marker while refreshing:

```tsx
{props.isRefreshing ? (
  <Text testID="home-conditions-refreshing" size="xs" className="font-semibold text-primary">
    {t('home.conditions.refreshing')}
  </Text>
) : null}
```

- [ ] **Step 6: Wire navigation and i18n**

In `apps/mobile/src/components/navigation/index.tsx`, pass:

```tsx
isLoading={logbook.isLoading}
```

to `HomeScreen`.

In `apps/mobile/src/i18n/resources.ts`, change:

```ts
latestWatchImport: '최근 로그',
importWatchDive: '최근 로그가 없습니다',
```

and English equivalents:

```ts
latestWatchImport: 'Recent log',
importWatchDive: 'No recent log',
```

Add explicit keys if using new names:

```ts
latestLog: '최근 로그',
noRecentLog: '최근 로그가 없습니다',
noRecentLogBody: '로그북에서 수동 로그를 작성하거나 워치 기록을 가져오면 여기에 표시됩니다.',
```

English:

```ts
latestLog: 'Recent log',
noRecentLog: 'No recent log',
noRecentLogBody: 'Create a manual log or import a watch log from Logbook to show it here.',
```

Add conditions keys:

```ts
refresh: '새로고침',
refreshing: '새로고침 중',
```

English:

```ts
refresh: 'Refresh',
refreshing: 'Refreshing',
```

- [ ] **Step 7: Run Home tests and commit Task 2**

Run:

```bash
yarn workspace @repo/mobile test --runTestsByPath apps/mobile/__tests__/home-conditions.test.tsx --runInBand
```

Expected: PASS.

Commit:

```bash
git add apps/mobile/src/conditions/use-home-conditions.ts apps/mobile/src/screens/home/screen.tsx apps/mobile/src/components/navigation/index.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/home-conditions.test.tsx
git commit -m "fix: clarify home loading and refresh states"
```

---

### Task 3: Logbook And Planning Loading States Plus Plan Workflow Rules

**Files:**
- Modify: `apps/mobile/src/screens/logbook/screen.tsx`
- Modify: `apps/mobile/src/screens/planning/screen.tsx`
- Modify: `apps/mobile/src/screens/planning/plan-detail.tsx`
- Modify: `apps/mobile/src/components/navigation/index.tsx`
- Modify: `apps/mobile/src/i18n/resources.ts`
- Test: `apps/mobile/__tests__/logbook-manual-entry.test.tsx`
- Test: `apps/mobile/__tests__/planning-screen.test.tsx`

- [ ] **Step 1: Add failing Logbook loading test**

Update `LogbookScreenProps` usage in `renderLogbook` helper to support `isLoading`, then add:

```tsx
test('shows skeleton rows while logbook entries are loading', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    await i18n.changeLanguage('en');
    renderer = ReactTestRenderer.create(
      <LogbookScreen
        entries={[]}
        filter={{ query: '' }}
        onFilterChange={jest.fn()}
        onSyncWatch={jest.fn(async () => ({ importedCount: 0, duplicateCount: 0, failedCount: 0, unavailable: false }))}
        onRefresh={jest.fn()}
        isLoading
        onSaveEntry={jest.fn()}
        onDeleteEntry={jest.fn()}
      />,
    );
  });
  renderers.push(renderer!);

  expect(renderer!.root.findByProps({ testID: 'logbook-loading-state' })).toBeTruthy();
  expect(renderer!.root.findAllByProps({ testID: 'logbook-empty-state' })).toHaveLength(0);
});
```

- [ ] **Step 2: Add failing Planning workflow tests**

In `apps/mobile/__tests__/planning-screen.test.tsx`, extend `HarnessProps` and `renderPlanning` options with `logEntryIds?: string[]`, pass to `PlanningScreen`, then add:

```tsx
it('shows skeleton rows while plans are loading', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    await i18n.changeLanguage('en');
    renderer = ReactTestRenderer.create(
      <PlanningScreen
        sessions={[]}
        plans={[]}
        isLoading
        onRefresh={jest.fn()}
        onSavePlan={jest.fn()}
        onOpenLogbook={jest.fn()}
      />,
    );
  });
  renderers.push(renderer!);

  expect(renderer!.root.findByProps({ testID: 'planning-loading-state' })).toBeTruthy();
  expect(renderer!.root.findAllByProps({ testID: 'planning-empty-state' })).toHaveLength(0);
});

it('promotes a draft plan to planned from detail', async () => {
  const repository = new LocalDivePlanRepository([
    plan({
      localId: 'draft-ready',
      status: 'draft',
      plannedAt: 1781355000,
      site: { name: 'Draft Ready Reef' },
      diveMode: 'scuba',
      plannedValues: {
        plannedMaxDepthMeters: 18,
        plannedDurationMinutes: 45,
      },
    }),
  ], { now: () => 1781357000 });
  const renderer = await renderPlanning(repository);
  const root = renderer.root;

  await press(root, 'planning-plan-row-Draft Ready Reef');
  await press(root, 'planning-detail-promote');

  const [savedPlan] = await repository.list();
  expect(savedPlan.status).toBe('planned');
  expect(savedPlan.updatedAt).toBe(1781357000);
});

it('hides completed-plan log creation while the connected log exists', async () => {
  const repository = new LocalDivePlanRepository([
    plan({
      localId: 'plan-with-log',
      status: 'completed',
      completedAt: 1781356000,
      convertedLogLocalId: 'log-existing',
      site: { name: 'Linked Log Reef' },
    }),
  ]);
  const renderer = await renderPlanning(repository, { logEntryIds: ['log-existing'] });
  const root = renderer.root;

  await press(root, 'planning-plan-row-Linked Log Reef');

  expect(root.findAllByProps({ testID: 'planning-detail-create-log' })).toHaveLength(0);
  expect(root.findByProps({ testID: 'planning-detail-log-created' })).toBeTruthy();
});

it('shows completed-plan log creation again when the connected log is missing', async () => {
  const onCreateLogFromPlan = jest.fn();
  const repository = new LocalDivePlanRepository([
    plan({
      localId: 'plan-missing-log',
      status: 'completed',
      completedAt: 1781356000,
      convertedLogLocalId: 'log-deleted',
      site: { name: 'Deleted Log Reef' },
    }),
  ]);
  const renderer = await renderPlanning(repository, { onCreateLogFromPlan, logEntryIds: [] });
  const root = renderer.root;

  await press(root, 'planning-plan-row-Deleted Log Reef');
  await press(root, 'planning-detail-create-log');

  expect(onCreateLogFromPlan).toHaveBeenCalledTimes(1);
});

it('labels plan water condition as expected water condition', async () => {
  const renderer = await renderPlanning(new LocalDivePlanRepository([]));
  const root = renderer.root;

  await press(root, 'planning-create-action');

  expect(root.findByProps({ testID: 'planning-editor-water-condition-label' }).props.children).toBe('Expected water condition');
});
```

- [ ] **Step 3: Run Logbook and Planning tests and verify failure**

Run:

```bash
yarn workspace @repo/mobile test --runTestsByPath apps/mobile/__tests__/logbook-manual-entry.test.tsx apps/mobile/__tests__/planning-screen.test.tsx --runInBand
```

Expected: FAIL for missing loading states, promotion action, log-link visibility, and water-condition label testID/copy.

- [ ] **Step 4: Implement Logbook loading skeleton**

In `apps/mobile/src/screens/logbook/screen.tsx`, add `isLoading?: boolean` to props and import `Skeleton`, `SkeletonText`.

Before empty state rendering:

```tsx
{route === 'list' ? (
  props.isLoading ? (
    <LogbookLoadingState />
  ) : visibleEntries.length === 0 ? (
    <EmptyLogbook />
  ) : (
    <VStack space="md">
      {visibleEntries.map(entry => (
        <SessionListItem key={entry.localId} entry={entry} onPress={() => openDetail(entry)} />
      ))}
    </VStack>
  )
) : null}
```

Add:

```tsx
function LogbookLoadingState(): React.JSX.Element {
  return (
    <VStack testID="logbook-loading-state" space="md">
      {[0, 1, 2].map(index => (
        <DiveSummaryCard key={index}>
          <VStack space="sm">
            <Skeleton className="h-5 w-40 rounded-full" />
            <SkeletonText _lines={2} className="h-4 rounded-full" />
          </VStack>
        </DiveSummaryCard>
      ))}
    </VStack>
  );
}
```

- [ ] **Step 5: Implement Planning loading skeleton**

In `apps/mobile/src/screens/planning/screen.tsx`, add `isLoading?: boolean` and import skeleton components. In the planbook list area:

```tsx
{props.isLoading ? (
  <PlanningLoadingState />
) : visiblePlans.length ? (
  <VStack space="md">
    {visiblePlans.map(plan => (
      <PlanRow key={plan.localId} plan={plan} locale={locale} onPress={() => openDetail(plan)} />
    ))}
  </VStack>
) : (
  <EmptyPlanbook />
)}
```

Add:

```tsx
function PlanningLoadingState(): React.JSX.Element {
  return (
    <VStack testID="planning-loading-state" space="md">
      {[0, 1, 2].map(index => (
        <DiveSummaryCard key={index}>
          <VStack space="sm">
            <Skeleton className="h-5 w-44 rounded-full" />
            <SkeletonText _lines={2} className="h-4 rounded-full" />
          </VStack>
        </DiveSummaryCard>
      ))}
    </VStack>
  );
}
```

- [ ] **Step 6: Add Planning promotion and log-link props**

In `PlanDetailProps`, add:

```ts
onPromote?: (plan: DivePlan) => Promise<void>;
hasExistingConvertedLog?: boolean;
```

Compute:

```ts
const canPromote = props.plan.status === 'draft' && props.onPromote;
const canComplete = props.plan.status === 'planned';
const canCreateLog = props.plan.status === 'completed' && !props.hasExistingConvertedLog;
```

Render:

```tsx
{canPromote ? (
  <InstrumentButton
    testID="planning-detail-promote"
    label={t('planning.promoteToPlan', { defaultValue: 'Promote to plan' })}
    variant="primary"
    onPress={() => props.onPromote?.(props.plan)}
  />
) : null}
{props.plan.status === 'completed' && props.hasExistingConvertedLog ? (
  <Text testID="planning-detail-log-created" className="text-sm font-semibold text-muted-foreground">
    {t('planning.logAlreadyCreated', { defaultValue: 'Log already created from this plan.' })}
  </Text>
) : null}
```

In `PlanningScreenProps`, add:

```ts
logEntryIds?: string[];
```

Add helper:

```tsx
const existingLogIds = React.useMemo(() => new Set(props.logEntryIds ?? []), [props.logEntryIds]);
const hasExistingConvertedLog = React.useCallback(
  (plan: DivePlan) => Boolean(plan.convertedLogLocalId && existingLogIds.has(plan.convertedLogLocalId)),
  [existingLogIds],
);
```

Add promotion:

```tsx
const promotePlan = React.useCallback(
  async (plan: DivePlan) => {
    if (!isPlanReadyForPromotion(plan)) {
      openEdit(plan);
      return;
    }

    const savedPlan = await savePlan({
      ...plan,
      status: 'planned',
      updatedAt: Date.now() / 1000,
    });
    setRoute('detail');
    setSelectedId(savedPlan.localId);
  },
  [openEdit, savePlan],
);
```

Add helper:

```tsx
function isPlanReadyForPromotion(plan: DivePlan): boolean {
  return Boolean(
    plan.plannedAt !== undefined &&
    plan.diveMode &&
    plan.site.name?.trim() &&
    plan.plannedValues.plannedMaxDepthMeters !== undefined &&
    plan.plannedValues.plannedDurationMinutes !== undefined,
  );
}
```

Pass to `PlanDetail`:

```tsx
onPromote={promotePlan}
hasExistingConvertedLog={hasExistingConvertedLog(selectedPlan)}
```

- [ ] **Step 7: Wire stack routes and navigation props**

In `RootNavigation`, pass loading:

```tsx
isLoading={logbook.isLoading}
```

to `LogbookScreen`, and:

```tsx
isLoading={planning.isLoading}
logEntryIds={logbook.entries.map(entry => entry.localId)}
```

to `PlanningScreen`.

Update `PlanningDetailRoute` props to receive `logbook: ReturnType<typeof useDiveLogbook>`. Pass it from the stack screen. In `PlanningDetailRoute`, compute:

```tsx
const hasExistingConvertedLog = Boolean(plan.convertedLogLocalId && props.logbook.entries.some(entry => entry.localId === plan.convertedLogLocalId));
```

Add `onPromote` to `PlanDetail` with the same `isPlanReadyForPromotion` guard and save behavior. If not ready, navigate to `planningEdit`.

- [ ] **Step 8: Rename Planning water condition label**

In `apps/mobile/src/screens/planning/plan-mode-fields.tsx`, set the label testID:

```tsx
<EditorField label={t('planning.expectedWaterCondition', { defaultValue: 'Expected water condition' })} labelTestID="planning-editor-water-condition-label">
```

In `apps/mobile/src/i18n/resources.ts`, add:

```ts
expectedWaterCondition: '예상 물 상태',
promoteToPlan: '계획으로 승격',
logAlreadyCreated: '이 계획에서 작성한 로그가 이미 있습니다.',
```

English:

```ts
expectedWaterCondition: 'Expected water condition',
promoteToPlan: 'Promote to plan',
logAlreadyCreated: 'Log already created from this plan.',
```

- [ ] **Step 9: Run focused tests and commit Task 3**

Run:

```bash
yarn workspace @repo/mobile test --runTestsByPath apps/mobile/__tests__/logbook-manual-entry.test.tsx apps/mobile/__tests__/planning-screen.test.tsx --runInBand
```

Expected: PASS.

Commit:

```bash
git add apps/mobile/src/screens/logbook/screen.tsx apps/mobile/src/screens/planning/screen.tsx apps/mobile/src/screens/planning/plan-detail.tsx apps/mobile/src/screens/planning/plan-mode-fields.tsx apps/mobile/src/components/navigation/index.tsx apps/mobile/src/i18n/resources.ts apps/mobile/__tests__/logbook-manual-entry.test.tsx apps/mobile/__tests__/planning-screen.test.tsx
git commit -m "fix: harden logbook and planning states"
```

---

### Task 4: Final Verification And Main Merge

**Files:**
- Verify all modified files.
- No planned source edits in this task unless verification finds a regression.

- [ ] **Step 1: Run all focused tests from prior tasks**

Run:

```bash
yarn workspace @repo/mobile test --runTestsByPath apps/mobile/__tests__/home-conditions.test.tsx apps/mobile/__tests__/logbook-manual-entry.test.tsx apps/mobile/__tests__/planning-screen.test.tsx apps/mobile/__tests__/number-wheel-picker.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run mobile typecheck**

Run:

```bash
yarn mobile:typecheck
```

Expected: PASS.

- [ ] **Step 3: Inspect diff and status**

Run:

```bash
git status --short
git log --oneline --max-count=6
```

Expected: clean worktree after commits, with the design, plan, and implementation commits on `mobile-ux-hardening`.

- [ ] **Step 4: Merge to main after verification**

Because the user explicitly requested merging to `main` after completion, switch to the original main worktree and merge the branch:

```bash
cd /Users/hongseongbin/Projects/diving-app
git status --short
git merge --ff-only mobile-ux-hardening
```

Expected: `main` advances fast-forward to the verified branch. If fast-forward is not possible, stop and report the conflict instead of forcing a merge.

- [ ] **Step 5: Run post-merge verification on main**

Run:

```bash
yarn mobile:typecheck
```

Expected: PASS on `main`.

If dependencies are missing in the main worktree, run `yarn install --frozen-lockfile` first, then rerun typecheck.

