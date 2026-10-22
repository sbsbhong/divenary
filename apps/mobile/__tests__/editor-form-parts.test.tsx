import React from 'react';
import { AccessibilityInfo, Keyboard, ScrollView, TextInput, View, type MeasureInWindowOnSuccessCallback } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../src/i18n';
import { Section } from '../src/components/ui/grouped-list';
import { InstrumentButton } from '../src/components/ui/instrument';
import { BadgeListInput } from '../src/screens/common/form/badge-list-field';
import { CollapsibleSection } from '../src/screens/common/form/collapsible-section';
import { DateTimeField, formatDateTimeParts } from '../src/screens/common/form/date-time-field';
import { EditorAnchor, EditorScreen, type EditorScreenHandle } from '../src/screens/common/form/editor-screen';
import { FieldRow } from '../src/screens/common/form/field-row';
import { PressureValueRows } from '../src/screens/common/form/pressure-fields';
import {
  DepthValueField,
  DurationValueField,
  NumberValueField,
} from '../src/screens/common/form/value-picker-field';
import { ValueRow } from '../src/screens/common/form/value-row';
import { WaterConditionControl, type WaterCondition } from '../src/screens/common/form/water-condition-field';
import type { DivePressureValues } from '../src/types/dive-log-entry';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const renderers: Renderer[] = [];

async function render(element: React.JSX.Element): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  renderers.push(renderer!);
  return renderer!;
}

/** The host node with this test ID (the native element, not a wrapper component). */
function host(renderer: Renderer, testID: string): ReactTestRenderer.ReactTestInstance | undefined {
  return renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];
}

function exists(renderer: Renderer, testID: string): boolean {
  return host(renderer, testID) !== undefined;
}

function textOf(renderer: Renderer, testID: string): string {
  const node = host(renderer, testID);
  if (!node) {
    throw new Error(`No element with testID ${testID}`);
  }
  const children = node.props.children as unknown;
  return Array.isArray(children) ? children.join('') : String(children);
}

/** Native text nodes that show exactly `text`. */
function textNodes(renderer: Renderer, text: string): ReactTestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(node => typeof node.type === 'string' && node.props.children === text);
}

/** The outermost element with this ID that handles presses. */
async function press(renderer: Renderer, testID: string): Promise<void> {
  const target = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
  if (!target) {
    throw new Error(`No pressable element with testID ${testID}`);
  }
  await ReactTestRenderer.act(async () => {
    target.props.onPress();
  });
}

/** Opens the wheel's direct entry inside an open sheet and submits `text`. */
async function typeIntoWheel(renderer: Renderer, testID: string, text: string): Promise<void> {
  await press(renderer, `${testID}-input-trigger`);
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findAll(node => node.props.testID === `${testID}-input` && typeof node.props.onChangeText === 'function')[0]
      .props.onChangeText(text);
  });
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findAll(node => node.props.testID === `${testID}-input` && typeof node.props.onSubmitEditing === 'function')[0]
      .props.onSubmitEditing();
  });
}

function triggerLabel(renderer: Renderer, testID: string): string {
  return renderer.root.findAll(
    node => node.props.testID === `${testID}-trigger` && typeof node.props.accessibilityLabel === 'string',
  )[0].props.accessibilityLabel;
}

/** Holds the value like a form controller does, and records every change. */
function Controlled<T>(props: {
  initialValue?: T;
  onChange?: (value: T | undefined) => void;
  children: (value: T | undefined, onChange: (value: T | undefined) => void) => React.JSX.Element;
}): React.JSX.Element {
  const [value, setValue] = React.useState<T | undefined>(props.initialValue);
  return props.children(value, nextValue => {
    props.onChange?.(nextValue);
    setValue(nextValue);
  });
}

beforeEach(async () => {
  await ReactTestRenderer.act(async () => {
    await i18n.changeLanguage('en');
  });
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount();
    }
  });
});

afterAll(async () => {
  await i18n.changeLanguage('ko');
});

describe('NumberValueField', () => {
  const renderPressure = (options: { initialValue?: number; onChange?: jest.Mock; quickValues?: number[]; clearable?: boolean } = {}) =>
    render(
      <Controlled<number> initialValue={options.initialValue} onChange={options.onChange}>
        {(value, onChange) => (
          <NumberValueField
            label="Start pressure"
            value={value}
            onChange={onChange}
            min={0}
            max={300}
            unitLabel="bar"
            valueType="int"
            startValue={200}
            quickValues={options.quickValues}
            clearable={options.clearable}
            testID="pressure"
          />
        )}
      </Controlled>,
    );

  test('shows an unknown value as -- with its unit, never 0, and reads it as not set', async () => {
    const renderer = await renderPressure();

    expect(textOf(renderer, 'pressure-row-value')).toBe('-- bar');
    expect(triggerLabel(renderer, 'pressure')).toBe('Start pressure, Not set');
    expect(exists(renderer, 'pressure-sheet')).toBe(false);
  });

  test('opens one wheel at the start value and saves it only on Done', async () => {
    const onChange = jest.fn();
    const renderer = await renderPressure({ onChange });

    await press(renderer, 'pressure-trigger');

    expect(exists(renderer, 'pressure-sheet')).toBe(true);
    expect(textOf(renderer, 'pressure-value')).toBe('200');
    expect(onChange).not.toHaveBeenCalled();
    expect(exists(renderer, 'pressure-clear')).toBe(false);

    await press(renderer, 'pressure-done');

    expect(onChange).toHaveBeenCalledWith(200);
    expect(exists(renderer, 'pressure-sheet')).toBe(false);
    expect(textOf(renderer, 'pressure-row-value')).toBe('200 bar');
  });

  test('saves direct entry from the wheel as it is typed', async () => {
    const onChange = jest.fn();
    const renderer = await renderPressure({ onChange });

    await press(renderer, 'pressure-trigger');
    await typeIntoWheel(renderer, 'pressure', '185');

    expect(onChange).toHaveBeenLastCalledWith(185);
    expect(textOf(renderer, 'pressure-row-value')).toBe('185 bar');
  });

  test('a quick value saves and closes, and shows as selected next time', async () => {
    const onChange = jest.fn();
    const renderer = await renderPressure({ onChange, quickValues: [180, 200, 400] });

    await press(renderer, 'pressure-trigger');
    expect(exists(renderer, 'pressure-chip-400')).toBe(false);
    await press(renderer, 'pressure-chip-180');

    expect(onChange).toHaveBeenCalledWith(180);
    expect(exists(renderer, 'pressure-sheet')).toBe(false);

    await press(renderer, 'pressure-trigger');
    const chip = renderer.root.findAll(
      node => node.props.testID === 'pressure-chip-180' && node.props.accessibilityState !== undefined,
    )[0];
    expect(chip.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  test('clear sets the value back to unknown, not 0', async () => {
    const onChange = jest.fn();
    const renderer = await renderPressure({ onChange, initialValue: 150 });

    expect(textOf(renderer, 'pressure-row-value')).toBe('150 bar');
    await press(renderer, 'pressure-trigger');
    await press(renderer, 'pressure-clear');

    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(exists(renderer, 'pressure-sheet')).toBe(false);
    expect(textOf(renderer, 'pressure-row-value')).toBe('-- bar');
  });

  test('can hide the clear action', async () => {
    const renderer = await renderPressure({ initialValue: 150, clearable: false });

    await press(renderer, 'pressure-trigger');

    expect(exists(renderer, 'pressure-clear')).toBe(false);
  });

  test('shows the error under the row and folds required and error into the spoken label', async () => {
    const renderer = await render(
      <NumberValueField
        label="Repetitions"
        onChange={jest.fn()}
        min={0}
        max={200}
        required
        error="Repetitions is required."
        testID="repetitions"
      />,
    );

    expect(textOf(renderer, 'repetitions-error')).toBe('Repetitions is required.');
    expect(textOf(renderer, 'repetitions-row-value')).toBe('--');
    expect(triggerLabel(renderer, 'repetitions')).toBe('Repetitions, Not set, Required, Repetitions is required.');
    expect(textNodes(renderer, 'Required')).toHaveLength(1);
  });

  test('hides the required marker once the field has a value', async () => {
    const renderer = await render(
      <NumberValueField label="Repetitions" value={8} onChange={jest.fn()} min={0} max={200} required testID="repetitions" />,
    );

    expect(textOf(renderer, 'repetitions-row-value')).toBe('8');
    expect(textNodes(renderer, 'Required')).toHaveLength(0);
  });
});

describe('DurationValueField', () => {
  const renderDuration = (onChange: jest.Mock, initialValue?: number) =>
    render(
      <Controlled<number> initialValue={initialValue} onChange={onChange}>
        {(value, change) => (
          <DurationValueField
            label="Dive time"
            valueSeconds={value}
            onChange={change}
            maxSeconds={50 * 60}
            testID="duration"
          />
        )}
      </Controlled>,
    );

  test('shows --:-- when unknown and offers minute chips that fit the limit', async () => {
    const onChange = jest.fn();
    const renderer = await renderDuration(onChange);

    expect(textOf(renderer, 'duration-row-value')).toBe('--:--');
    await press(renderer, 'duration-trigger');

    expect(exists(renderer, 'duration-chip-30')).toBe(true);
    expect(exists(renderer, 'duration-chip-45')).toBe(true);
    expect(exists(renderer, 'duration-chip-60')).toBe(false);

    await press(renderer, 'duration-chip-30');

    expect(onChange).toHaveBeenCalledWith(30 * 60);
    expect(textOf(renderer, 'duration-row-value')).toBe('30:00');
    expect(triggerLabel(renderer, 'duration')).toBe('Dive time, 30 min');
  });

  test('Done saves the 45 minute start when nothing was picked', async () => {
    const onChange = jest.fn();
    const renderer = await renderDuration(onChange);

    await press(renderer, 'duration-trigger');
    await press(renderer, 'duration-done');

    expect(onChange).toHaveBeenCalledWith(45 * 60);
  });

  test('accepts typed minutes and seconds', async () => {
    const onChange = jest.fn();
    const renderer = await renderDuration(onChange);

    await press(renderer, 'duration-trigger');
    await typeIntoWheel(renderer, 'duration', '47:30');

    expect(onChange).toHaveBeenLastCalledWith(47 * 60 + 30);
    expect(textOf(renderer, 'duration-row-value')).toBe('47:30');
    expect(triggerLabel(renderer, 'duration')).toBe('Dive time, 47 min 30 sec');
  });
});

describe('DepthValueField', () => {
  test('shows -- m when unknown, starts at 18 m and shows one decimal', async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <Controlled<number> onChange={onChange}>
        {(value, change) => (
          <DepthValueField
            label="Max depth"
            valueMeters={value}
            onChange={change}
            maxMeters={60}
            footer={value !== undefined && value > 40 ? <ValueRowNote /> : null}
            testID="depth"
          />
        )}
      </Controlled>,
    );

    expect(textOf(renderer, 'depth-row-value')).toBe('-- m');
    await press(renderer, 'depth-trigger');
    expect(['5', '10', '18', '30'].every(meters => exists(renderer, `depth-chip-${meters}`))).toBe(true);

    await press(renderer, 'depth-done');
    expect(onChange).toHaveBeenCalledWith(18);
    expect(textOf(renderer, 'depth-row-value')).toBe('18.0 m');

    await press(renderer, 'depth-trigger');
    await typeIntoWheel(renderer, 'depth', '42.6');
    expect(onChange).toHaveBeenLastCalledWith(42.6);
    expect(textOf(renderer, 'depth-row-value')).toBe('42.6 m');
    expect(exists(renderer, 'depth-note-row')).toBe(true);
  });
});

function ValueRowNote(): React.JSX.Element {
  return <ValueRow label="Note" value="Outside supported depth" emptyText="--" testID="depth-note" separated={false} />;
}

describe('ValueRow', () => {
  test('a read-only row has no button, a chevron-free value and a low-chroma badge', async () => {
    const renderer = await render(
      <ValueRow label="Max depth" value="18.6 m" emptyText="-- m" badge="Watch measured" testID="watch-depth" />,
    );

    expect(exists(renderer, 'watch-depth-trigger')).toBe(false);
    expect(host(renderer, 'watch-depth-row')?.props.accessibilityLabel).toBe('Max depth, Watch measured, 18.6 m');
    expect(host(renderer, 'watch-depth-badge')?.props.className).toContain('bg-muted');
  });
});

describe('DateTimeField', () => {
  const now = new Date(2026, 9, 22, 14, 30);

  beforeEach(() => {
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('formats the date and time in the current language and adds the year only for another year', () => {
    expect(formatDateTimeParts(new Date(2026, 9, 22, 14, 30), 'en', now)).toEqual({ date: 'Thu, Oct 22', time: '2:30 PM' });
    expect(formatDateTimeParts(new Date(2026, 9, 22, 14, 30), 'ko', now)).toEqual({ date: '10월 22일 (목)', time: '오후 2:30' });
    expect(formatDateTimeParts(new Date(2025, 0, 5, 9, 5), 'en', now).date).toBe('Sun, Jan 5, 2025');
  });

  test('opens a sheet with a native wheel capped at the maximum date and saves changes at once', async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <Controlled<Date> initialValue={new Date(2026, 9, 21, 9, 0)} onChange={onChange}>
        {(value, change) => (
          <DateTimeField label="Start" value={value} onChange={change} maximumDate={now} required testID="started-at" />
        )}
      </Controlled>,
    );

    expect(textOf(renderer, 'started-at-date')).toBe('Wed, Oct 21');
    expect(textOf(renderer, 'started-at-time')).toBe('9:00 AM');

    await press(renderer, 'started-at-trigger');
    const picker = renderer.root.findAll(
      node => node.props.testID === 'started-at-picker' && typeof node.props.onValueChange === 'function',
    )[0];
    expect(picker.props.maximumDate).toBe(now);
    expect(picker.props.locale).toBe('en');

    await ReactTestRenderer.act(async () => {
      picker.props.onValueChange({ nativeEvent: { timestamp: 0, utcOffset: 0 } }, new Date(2026, 9, 22, 7, 15));
    });

    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 9, 22, 7, 15));
    expect(textOf(renderer, 'started-at-time')).toBe('7:15 AM');
    expect(exists(renderer, 'started-at-clear')).toBe(false);

    await press(renderer, 'started-at-done');
    expect(exists(renderer, 'started-at-sheet')).toBe(false);
  });

  test('shows -- when empty and Done saves now, kept inside the range', async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <Controlled<Date> onChange={onChange}>
        {(value, change) => <DateTimeField label="Planned" value={value} onChange={change} required testID="planned-at" />}
      </Controlled>,
    );

    expect(textOf(renderer, 'planned-at-date')).toBe('--');
    expect(textOf(renderer, 'planned-at-time')).toBe('--:--');

    await press(renderer, 'planned-at-trigger');
    await press(renderer, 'planned-at-done');

    expect(onChange).toHaveBeenCalledWith(now);
    expect(textOf(renderer, 'planned-at-time')).toBe('2:30 PM');
  });

  test('switches the display language with the app', async () => {
    const renderer = await render(
      <DateTimeField label="시작" value={new Date(2026, 9, 22, 14, 30)} onChange={jest.fn()} testID="started-at" />,
    );

    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });

    expect(textOf(renderer, 'started-at-date')).toBe('10월 22일 (목)');
    expect(textOf(renderer, 'started-at-time')).toBe('오후 2:30');
  });
});

describe('CollapsibleSection', () => {
  const details = (
    <Section title="Conditions">
      <ValueRow label="Visibility" emptyText="--" testID="visibility" separated={false} />
    </Section>
  );

  function toggleState(renderer: Renderer) {
    return renderer.root.findAll(
      node => node.props.testID === 'details-toggle' && node.props.accessibilityState !== undefined,
    )[0].props.accessibilityState;
  }

  test('starts collapsed with a summary when the draft has no detail values', async () => {
    const renderer = await render(
      <CollapsibleSection title="More details" summary="Entry, conditions, gear" hasValues={false} testID="details">
        {details}
      </CollapsibleSection>,
    );

    expect(exists(renderer, 'details-content')).toBe(false);
    expect(toggleState(renderer)).toEqual(expect.objectContaining({ expanded: false }));
    expect(textNodes(renderer, 'Entry, conditions, gear')).toHaveLength(1);

    await press(renderer, 'details-toggle');

    expect(exists(renderer, 'details-content')).toBe(true);
    expect(exists(renderer, 'visibility-trigger') || exists(renderer, 'visibility-row')).toBe(true);
    expect(toggleState(renderer)).toEqual(expect.objectContaining({ expanded: true }));
  });

  test('starts open when the draft already has detail values', async () => {
    const renderer = await render(
      <CollapsibleSection title="More details" hasValues testID="details">
        {details}
      </CollapsibleSection>,
    );

    expect(exists(renderer, 'details-content')).toBe(true);
  });

  test('opens when forceOpen turns true, for an invalid field inside', async () => {
    const renderer = await render(
      <CollapsibleSection title="More details" hasValues={false} forceOpen={false} testID="details">
        {details}
      </CollapsibleSection>,
    );

    await ReactTestRenderer.act(async () => {
      renderer.update(
        <CollapsibleSection title="More details" hasValues={false} forceOpen testID="details">
          {details}
        </CollapsibleSection>,
      );
    });

    expect(exists(renderer, 'details-content')).toBe(true);
  });
});

describe('EditorScreen', () => {
  // The sticky save bar reads the safe area, as it does under the app's providers.
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

  const renderEditor = (props: Partial<React.ComponentProps<typeof EditorScreen>> & { editorRef?: React.Ref<EditorScreenHandle> }) =>
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <EditorScreen
          ref={props.editorRef}
          title="New log"
          eyebrow={props.eyebrow}
          titleTestID="editor-title"
          onBack={props.onBack ?? jest.fn()}
          backTestID="editor-back"
          actions={<InstrumentButton testID="editor-save" label="Save" variant="primary" />}
          actionError={props.actionError}
          actionErrorTestID="editor-error"
          testID="editor">
          <EditorAnchor name="basic" anchorTestID="editor-basic-anchor">
            {null}
          </EditorAnchor>
          <EditorAnchor name="details" anchorTestID="editor-details-anchor">
            {null}
          </EditorAnchor>
        </EditorScreen>
      </SafeAreaProvider>,
    );

  test('pins back, title and the save action, and scrolls to a measured anchor', async () => {
    const ref = React.createRef<EditorScreenHandle>();
    const onBack = jest.fn();
    const renderer = await renderEditor({ editorRef: ref, onBack, eyebrow: 'Manual' });

    expect(textOf(renderer, 'editor-title')).toBe('New log');
    expect(exists(renderer, 'editor-back-icon')).toBe(true);
    expect(exists(renderer, 'editor-actions')).toBe(true);
    await press(renderer, 'editor-back');
    expect(onBack).toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      host(renderer, 'editor-body')!.props.onLayout({ nativeEvent: { layout: { y: 16 } } });
      renderer.root.findByProps({ testID: 'editor-details-anchor' }).props.onLayout({ nativeEvent: { layout: { y: 420 } } });
    });

    let scrolled = false;
    await ReactTestRenderer.act(async () => {
      scrolled = ref.current!.scrollToAnchor('details');
    });

    // Body offset 16 + anchor 420 - 16 px gap above the anchor.
    expect(scrolled).toBe(true);
    expect(textOf(renderer, 'editor-scroll-target')).toBe('420');
    expect(ref.current!.scrollToAnchor('missing')).toBe(false);
  });

  test('shows a save failure above the action and announces it', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const renderer = await renderEditor({ actionError: 'Could not save this log.' });

    expect(textOf(renderer, 'editor-error')).toBe('Could not save this log.');
    expect(announce).toHaveBeenCalledWith('Could not save this log.');
    announce.mockRestore();
  });

  test('measures the keyboard from where the editor starts and scrolls a hidden focused field above the save bar', async () => {
    // Window positions as on a phone: the editor starts under a 47 pt status bar inset, the save
    // bar sits above the keyboard at y 600, and the focused field ends at y 640, under the bar.
    const measureInWindow = jest
      .spyOn(View.prototype, 'measureInWindow')
      .mockImplementation(function (this: { props: { testID?: string } }, callback) {
        callback(0, this.props.testID === 'editor-action-bar' ? 600 : 47, 390, 100);
      });
    const focusedInput = jest
      .spyOn(TextInput.State, 'currentlyFocusedInput')
      .mockReturnValue({ measureInWindow: (callback: MeasureInWindowOnSuccessCallback) => callback(0, 596, 300, 44) } as never);
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const addKeyboardListener = jest.spyOn(Keyboard, 'addListener');
    const renderer = await renderEditor({});

    await ReactTestRenderer.act(async () => {
      host(renderer, 'editor')!.props.onLayout({ nativeEvent: { layout: { y: 0 } } });
    });
    expect(renderer.root.findByProps({ testID: 'editor-keyboard-avoiding' }).props.keyboardVerticalOffset).toBe(47);

    const keyboardDidShow = addKeyboardListener.mock.calls.find(([eventName]) => eventName === 'keyboardDidShow')?.[1];
    await ReactTestRenderer.act(async () => {
      keyboardDidShow?.({} as never);
    });

    // The field ends at 640; with the 16 pt gap it needs 56 pt more to clear the bar at 600.
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 56, animated: true });

    measureInWindow.mockRestore();
    focusedInput.mockRestore();
    scrollTo.mockRestore();
    addKeyboardListener.mockRestore();
  });
});

describe('FieldRow and BadgeListInput', () => {
  test('a field row carries the label, required marker and error for any control', async () => {
    const renderer = await render(
      <FieldRow label="Site" required error="Enter a site name." errorTestID="site-error" testID="site-anchor">
        {null}
      </FieldRow>,
    );

    expect(textOf(renderer, 'site-error')).toBe('Enter a site name.');
    expect(textNodes(renderer, 'Required')).toHaveLength(1);
  });

  test('suggestion chips add an earlier value and hide values already in the list', async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <Controlled<string[]> initialValue={['Mina']} onChange={onChange}>
        {(values, change) => (
          <BadgeListInput
            values={values ?? []}
            onChange={nextValues => change(nextValues)}
            inputTestID="buddies-input"
            accessibilityLabel="Buddies"
            badgeTestIDPrefix="buddies"
            autoCapitalize="words"
            suggestions={['Mina', 'Alex']}
          />
        )}
      </Controlled>,
    );

    expect(exists(renderer, 'buddies-suggestion-Mina')).toBe(false);
    expect(host(renderer, 'buddies-input')?.props.autoCapitalize).toBe('words');
    // VoiceOver hears the row's label, not the vendored field's English default "Input Field".
    expect(host(renderer, 'buddies-input')?.props['aria-label']).toBe('Buddies');
    await press(renderer, 'buddies-suggestion-Alex');

    expect(onChange).toHaveBeenLastCalledWith(['Mina', 'Alex']);
    expect(exists(renderer, 'buddies-badge-Alex')).toBe(true);
    expect(exists(renderer, 'buddies-suggestion-Alex')).toBe(false);
  });
});

describe('PressureValueRows', () => {
  test('uses value rows with no quick chips, starting the wheel at a common fill pressure', async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <Controlled<DivePressureValues> initialValue={{ unit: 'bar' }} onChange={onChange}>
        {(value, change) => (
          <Section>
            <PressureValueRows
              unit={value?.unit}
              start={value?.start}
              end={value?.end}
              onChange={change}
              testIDPrefix="pressure"
              labels={{ unit: 'Pressure unit', start: 'Start pressure', end: 'End pressure' }}
              separated={false}
            />
          </Section>
        )}
      </Controlled>,
    );

    expect(textOf(renderer, 'pressure-start-row-value')).toBe('-- bar');
    expect(textOf(renderer, 'pressure-end-row-value')).toBe('-- bar');

    await press(renderer, 'pressure-start-trigger');
    expect(textOf(renderer, 'pressure-start-value')).toBe('200');
    expect(renderer.root.findAll(node => typeof node.props.testID === 'string' && node.props.testID.includes('-chip-'))).toHaveLength(0);
    await press(renderer, 'pressure-start-done');

    expect(onChange).toHaveBeenLastCalledWith({ unit: 'bar', start: 200, end: undefined });

    await press(renderer, 'pressure-end-trigger');
    expect(textOf(renderer, 'pressure-end-value')).toBe('200');
    await press(renderer, 'pressure-end-done');

    await press(renderer, 'pressure-unit-psi');
    expect(onChange).toHaveBeenLastCalledWith({ unit: 'psi', start: 200, end: 200 });
    expect(textOf(renderer, 'pressure-start-row-value')).toBe('200 psi');
  });
});

describe('WaterConditionControl', () => {
  test('offers five conditions in two segmented rows, never unknown, and a second tap clears', async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <Controlled<WaterCondition> onChange={onChange}>
        {(value, change) => <WaterConditionControl value={value} onChange={change} testIDPrefix="water" />}
      </Controlled>,
    );
    const selected = (condition: WaterCondition) =>
      renderer.root.findAll(node => node.props.testID === `water-${condition}` && node.props.accessibilityState !== undefined)[0].props
        .accessibilityState.selected;

    for (const condition of ['calm', 'mild', 'choppy', 'surge', 'current'] as const) {
      expect(exists(renderer, `water-${condition}`)).toBe(true);
    }
    expect(renderer.root.findAll(node => node.props.testID === 'water-unknown')).toHaveLength(0);

    await press(renderer, 'water-mild');
    expect(onChange).toHaveBeenLastCalledWith('mild');
    expect(selected('mild')).toBe(true);

    await press(renderer, 'water-mild');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(selected('mild')).toBe(false);
  });

  test('reads a stored unknown as no selection', async () => {
    const renderer = await render(<WaterConditionControl value="unknown" onChange={jest.fn()} testIDPrefix="water" />);
    const selectedChoices = renderer.root.findAll(
      node => typeof node.props.testID === 'string' && node.props.testID.startsWith('water-') && node.props.accessibilityState?.selected === true,
    );

    expect(selectedChoices).toHaveLength(0);
  });
});
