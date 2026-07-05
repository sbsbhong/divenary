import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  DEFAULT_WHEEL_HEIGHT,
  ITEM_HEIGHT,
  NumberWheelPicker,
  OPTION_EMPHASIS_ANIMATION_DURATION_MS,
  getWheelLayout,
} from '../src/components/ui/number-wheel-picker';
import { MultiColumnNumberWheelPicker } from '../src/components/ui/multi-column-number-wheel-picker';
import { DepthWheelField, DurationWheelField } from '../src/screens/common/form/compound-number-wheel-fields';
import { NumericSliderField } from '../src/screens/common/form/numeric-slider-field';

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    for (const renderer of renderers.splice(0)) {
      renderer.unmount();
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
});

describe('NumberWheelPicker', () => {
  it('uses a 176px default wheel height with five visible candidates', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={10} min={0} max={20} step={5} unitLabel="m" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const wheel = renderer!.root.findByProps({ testID: 'depth-picker-wheel' });
    const list = renderer!.root.findByProps({ testID: 'depth-picker-wheel-list' });

    expect(ITEM_HEIGHT).toBe(36);
    expect(DEFAULT_WHEEL_HEIGHT).toBe(176);
    expect(wheel.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ height: 176 })]));
    expect(list.props.snapToInterval).toBe(36);
    expect(list.props.contentContainerStyle).toEqual(expect.arrayContaining([expect.objectContaining({ paddingVertical: 70 })]));
  });

  it('derives visible candidate counts from custom picker heights', () => {
    expect(getWheelLayout(132)).toEqual({ wheelHeight: 132, visibleItemCount: 3, centerPadding: 48 });
    expect(getWheelLayout(176)).toEqual({ wheelHeight: 176, visibleItemCount: 5, centerPadding: 70 });
    expect(getWheelLayout(220)).toEqual({ wheelHeight: 220, visibleItemCount: 7, centerPadding: 92 });
    expect(getWheelLayout(80)).toEqual({ wheelHeight: 108, visibleItemCount: 3, centerPadding: 36 });
  });

  it('supports compound Root, Wheel, SelectionOverlay, and CenterInputTrigger composition', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker.Root value={10} min={0} max={20} step={5} unitLabel="m" onChange={onChange} testID="depth-picker">
          <NumberWheelPicker.Wheel />
          <NumberWheelPicker.SelectionOverlay />
          <NumberWheelPicker.CenterInputTrigger />
        </NumberWheelPicker.Root>,
      );
    });
    renderers.push(renderer!);

    const list = renderer!.root.findByProps({ testID: 'depth-picker-wheel-list' });
    expect(list.props.snapToInterval).toBe(ITEM_HEIGHT);
    expect(renderer!.root.findByProps({ testID: 'depth-picker-value' }).props.children).toBe('10');

    await ReactTestRenderer.act(async () => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 3 } } });
    });

    expect(onChange).toHaveBeenCalledWith(15);
    expect(renderer!.root.findByProps({ testID: 'depth-picker-value' }).props.children).toBe('15');
  });

  it('renders multiple numeric columns in one shared wheel box', async () => {
    const onColumnChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <MultiColumnNumberWheelPicker
          columns={[
            { id: 'minutes', value: 10, min: 0, max: 240, step: 1, unitLabel: 'min' },
            { id: 'seconds', value: 3, min: 0, max: 59, step: 1, unitLabel: 'sec', padStart: 2 },
          ]}
          onColumnChange={onColumnChange}
          directInput={{
            value: '10:03',
            normalize: value => value,
            onCommit: () => false,
            keyboardType: 'numbers-and-punctuation',
          }}
          testID="duration-picker"
        />,
      );
    });
    renderers.push(renderer!);

    expect(renderer!.root.findByProps({ testID: 'duration-picker-wheel' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'duration-picker-selection-frame' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'duration-picker-column-minutes-wheel-list' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'duration-picker-column-seconds-wheel-list' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'duration-picker-minutes-value' }).props.children).toBe('10');
    expect(renderer!.root.findByProps({ testID: 'duration-picker-minutes-unit' }).props.children).toBe('min');
    expect(renderer!.root.findByProps({ testID: 'duration-picker-seconds-value' }).props.children).toBe('03');
    expect(renderer!.root.findByProps({ testID: 'duration-picker-seconds-unit' }).props.children).toBe('sec');
  });

  it('emits only the changed multi-column value while scrolling', async () => {
    const onColumnChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <MultiColumnNumberWheelPicker
          columns={[
            { id: 'minutes', value: 10, min: 0, max: 240, step: 1, unitLabel: 'min' },
            { id: 'seconds', value: 0, min: 0, max: 59, step: 1, unitLabel: 'sec', padStart: 2 },
          ]}
          onColumnChange={onColumnChange}
          directInput={{
            value: '10:00',
            normalize: value => value,
            onCommit: () => false,
            keyboardType: 'numbers-and-punctuation',
          }}
          testID="duration-picker"
        />,
      );
    });
    renderers.push(renderer!);

    const secondsList = renderer!.root.findByProps({ testID: 'duration-picker-column-seconds-wheel-list' });
    await ReactTestRenderer.act(async () => {
      secondsList.props.onScroll({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 3 } } });
    });

    expect(onColumnChange).toHaveBeenCalledWith('seconds', 3);
    expect(renderer!.root.findByProps({ testID: 'duration-picker-seconds-value' }).props.children).toBe('03');
  });

  it('renders fixed columns in the shared center row without a scroll view', async () => {
    const onColumnChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <MultiColumnNumberWheelPicker
          columns={[
            { id: 'meters', value: 19, min: 0, max: 60, step: 1 },
            { id: 'tenths', value: 6, min: 0, max: 9, step: 1, formatValue: value => `.${value}` },
            { id: 'unit', fixedLabel: 'm' },
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

    expect(renderer!.root.findByProps({ testID: 'depth-picker-meters-value' }).props.children).toBe('19');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-tenths-value' }).props.children).toBe('.6');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-unit-fixed' }).props.children).toBe('m');
    expect(renderer!.root.findAllByProps({ testID: 'depth-picker-column-unit-wheel-list' })).toHaveLength(0);
  });

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
    expect(fixedUnitColumn.props.style).toEqual({ width: 22 });
    expect(renderer!.root.findByProps({ testID: 'depth-picker-column-meters-option-18-value' }).props.children).toBe('18');
    expect(renderer!.root.findAllByProps({ testID: 'depth-picker-column-meters-option-18-unit-column' })).toHaveLength(0);
    expect(renderer!.root.findByProps({ testID: 'depth-picker-meters-value' }).props.children).toBe('19');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-tenths-value' }).props.children).toBe('.6');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-unit-fixed' }).props.children).toBe('m');
  });

  it('renders duration seconds as minute and second columns without emitting on mount', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DurationWheelField
          label="Duration"
          valueSeconds={602}
          maxSeconds={240 * 60}
          onChange={onChange}
          testID="duration-picker"
        />,
      );
    });
    renderers.push(renderer!);

    expect(renderer!.root.findByProps({ testID: 'duration-picker-minutes-value' }).props.children).toBe('10');
    expect(renderer!.root.findByProps({ testID: 'duration-picker-seconds-value' }).props.children).toBe('02');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits composed seconds when the duration seconds column changes', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DurationWheelField
          label="Duration"
          valueSeconds={600}
          maxSeconds={240 * 60}
          onChange={onChange}
          testID="duration-picker"
        />,
      );
    });
    renderers.push(renderer!);

    const secondsList = renderer!.root.findByProps({ testID: 'duration-picker-column-seconds-wheel-list' });
    await ReactTestRenderer.act(async () => {
      secondsList.props.onScroll({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 3 } } });
    });

    expect(onChange).toHaveBeenCalledWith(603);
  });

  it('commits duration direct input in colon, unit, and seconds forms', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DurationWheelField
          label="Duration"
          valueSeconds={0}
          maxSeconds={240 * 60}
          onChange={onChange}
          testID="duration-picker"
        />,
      );
    });
    renderers.push(renderer!);

    const root = renderer!.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'duration-picker-input-trigger' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'duration-picker-input' }).find(match => typeof match.props.onChangeText === 'function')!.props.onChangeText('10:03');
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'duration-picker-input' }).find(match => typeof match.props.onSubmitEditing === 'function')!.props.onSubmitEditing();
    });
    expect(onChange).toHaveBeenLastCalledWith(603);

    await ReactTestRenderer.act(async () => {
      renderer!.update(
        <DurationWheelField
          label="Duration"
          valueSeconds={0}
          maxSeconds={240 * 60}
          onChange={onChange}
          testID="duration-picker"
        />,
      );
    });
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'duration-picker-input-trigger' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'duration-picker-input' }).find(match => typeof match.props.onChangeText === 'function')!.props.onChangeText('10m03s');
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'duration-picker-input' }).find(match => typeof match.props.onSubmitEditing === 'function')!.props.onSubmitEditing();
    });
    expect(onChange).toHaveBeenLastCalledWith(603);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'duration-picker-input-trigger' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'duration-picker-input' }).find(match => typeof match.props.onChangeText === 'function')!.props.onChangeText('603');
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'duration-picker-input' }).find(match => typeof match.props.onSubmitEditing === 'function')!.props.onSubmitEditing();
    });
    expect(onChange).toHaveBeenLastCalledWith(603);
  });

  it('renders depth meters as integer, decimal, and fixed meter columns', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DepthWheelField
          label="Max depth"
          valueMeters={18.6}
          maxMeters={60}
          onChange={onChange}
          testID="depth-picker"
        />,
      );
    });
    renderers.push(renderer!);

    expect(renderer!.root.findByProps({ testID: 'depth-picker-meters-value' }).props.children).toBe('18');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-tenths-value' }).props.children).toBe('.6');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-unit-fixed' }).props.children).toBe('m');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits depth direct input and clamps to max tenth precision', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DepthWheelField
          label="Max depth"
          valueMeters={0}
          maxMeters={60}
          onChange={onChange}
          testID="depth-picker"
        />,
      );
    });
    renderers.push(renderer!);

    const root = renderer!.root;
    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'depth-picker-input-trigger' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onChangeText === 'function')!.props.onChangeText('19.6');
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onSubmitEditing === 'function')!.props.onSubmitEditing();
    });

    expect(onChange).toHaveBeenLastCalledWith(19.6);

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'depth-picker-input-trigger' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onChangeText === 'function')!.props.onChangeText('99.9');
    });
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onSubmitEditing === 'function')!.props.onSubmitEditing();
    });

    expect(onChange).toHaveBeenLastCalledWith(60);
  });

  it('keeps undefined compound values visual only until the user changes them', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <DepthWheelField
          label="Max depth"
          valueMeters={undefined}
          maxMeters={60}
          onChange={onChange}
          testID="depth-picker"
        />,
      );
    });
    renderers.push(renderer!);

    expect(renderer!.root.findByProps({ testID: 'depth-picker-meters-value' }).props.children).toBe('0');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-tenths-value' }).props.children).toBe('.0');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a plain scroll-backed snapping wheel from min to max using step', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={10} min={0} max={20} step={5} unitLabel="m" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const list = renderer!.root.findByProps({ testID: 'depth-picker-wheel-list' });

    expect(list.props.data).toBeUndefined();
    expect(list.props.getItemLayout).toBeUndefined();
    expect(
      new Set(
        renderer!.root
          .findAll(node => typeof node.props.testID === 'string' && node.props.testID.endsWith('-content'))
          .map(node => node.props.testID),
      ),
    ).toEqual(
      new Set([
        'depth-picker-option-0-content',
        'depth-picker-option-5-content',
        'depth-picker-option-10-content',
        'depth-picker-option-15-content',
        'depth-picker-option-20-content',
      ]),
    );
    expect(list.props.snapToInterval).toBe(ITEM_HEIGHT);
    expect(list.props.scrollEventThrottle).toBe(16);
    expect(list.props.showsVerticalScrollIndicator).toBe(false);
    expect(renderer!.root.findByProps({ testID: 'depth-picker-value' }).props.children).toBe('10');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-unit' }).props.children).toBe('m');
  });

  it('renders only a bounded option window for large numeric ranges', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={0} min={0} max={60} step={0.1} unitLabel="m" valueType="float" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const renderedOptionValues = renderer!.root.findAll(
      node => typeof node.props.testID === 'string' && /^depth-picker-option-[\d.]+-value$/.test(node.props.testID),
    );

    expect(renderedOptionValues.length).toBeLessThan(40);
    expect(renderer!.root.findByProps({ testID: 'depth-picker-option-0-value' }).props.children).toBe('0');
    expect(renderer!.root.findAllByProps({ testID: 'depth-picker-option-60-value' })).toHaveLength(0);
  });

  it('renders option rows with separate value and unit columns', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={150} min={148} max={152} step={1} unitLabel="m" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const centeredValue = renderer!.root.findByProps({ testID: 'depth-picker-option-150-value' });
    const centeredUnit = renderer!.root.findByProps({ testID: 'depth-picker-option-150-unit' });

    expect(centeredValue.props.children).toBe('150');
    expect(centeredValue.props.className).toContain('opacity-0');
    expect(centeredUnit.props.children).toBe('m');
    expect(centeredUnit.props.className).toContain('opacity-0');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-center-value-column' })).toBeTruthy();
    expect(renderer!.root.findByProps({ testID: 'depth-picker-center-unit-column' })).toBeTruthy();
  });

  it('keeps the centered value layout wide enough for narrow two-column picker cards', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={10} min={0} max={240} step={1} unitLabel="min" onChange={onChange} testID="duration-picker" />,
      );
    });
    renderers.push(renderer!);

    const centerRow = renderer!.root.findByProps({ testID: 'duration-picker-center-row' });
    const centerValue = renderer!.root.findByProps({ testID: 'duration-picker-value' });

    expect(centerRow.props.className).toContain('w-full');
    expect(centerValue.props.children).toBe('10');
    expect(centerValue.props.numberOfLines).toBe(1);
    expect(centerValue.props.adjustsFontSizeToFit).toBe(true);
    expect(centerValue.props.minimumFontScale).toBe(0.75);
  });

  it('emphasizes adjacent options with a fast transform animation', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={10} min={0} max={20} step={5} unitLabel="m" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    expect(OPTION_EMPHASIS_ANIMATION_DURATION_MS).toBeLessThanOrEqual(120);
    expect(renderer!.root.findByProps({ testID: 'depth-picker-option-5-value' }).props.className).toContain('text-lg');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-option-15-value' }).props.className).toContain('text-lg');
    expect(renderer!.root.findByProps({ testID: 'depth-picker-option-5-content' }).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ transform: expect.any(Array) })]),
    );
  });

  it('selects the nearest value when momentum scrolling ends', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={10} min={0} max={20} step={5} unitLabel="m" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const list = renderer!.root.findByProps({ testID: 'depth-picker-wheel-list' });

    await ReactTestRenderer.act(async () => {
      list.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 3.2 } } });
    });

    expect(onChange).toHaveBeenCalledWith(15);
  });

  it('updates the centered value while the wheel is scrolling', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={10} min={0} max={20} step={5} unitLabel="m" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const list = renderer!.root.findByProps({ testID: 'depth-picker-wheel-list' });

    await ReactTestRenderer.act(async () => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 3 } } });
    });

    expect(onChange).toHaveBeenCalledWith(15);
    expect(renderer!.root.findByProps({ testID: 'depth-picker-value' }).props.children).toBe('15');
  });

  it('accepts decimal keyboard entry when valueType is float', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={0} min={0} max={40} step={0.1} unitLabel="m" valueType="float" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const root = renderer!.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'depth-picker-input-trigger' }).props.onPress();
    });

    const input = root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onChangeText === 'function');
    expect(input).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      input!.props.onChangeText('15.');
      input!.props.onChangeText('15.3');
    });

    const updatedInput = root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onSubmitEditing === 'function');
    await ReactTestRenderer.act(async () => {
      updatedInput!.props.onSubmitEditing();
    });

    expect(onChange).toHaveBeenCalledWith(15.3);
  });

  it('accepts a large direct integer entry and emits the snapped value', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={0} min={0} max={200} step={1} unitLabel="m" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const root = renderer!.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'depth-picker-input-trigger' }).props.onPress();
    });

    const input = root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onChangeText === 'function');
    expect(input).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      input!.props.onChangeText('150');
    });

    const updatedInput = root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onSubmitEditing === 'function');
    await ReactTestRenderer.act(async () => {
      updatedInput!.props.onSubmitEditing();
    });

    expect(onChange).toHaveBeenCalledWith(150);
    expect(root.findByProps({ testID: 'depth-picker-value' }).props.children).toBe('150');
  });

  it('clamps direct entry to max and snaps to step before emitting', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={0} min={0} max={42} step={5} unitLabel="m" onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const root = renderer!.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'depth-picker-input-trigger' }).props.onPress();
    });

    const input = root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onChangeText === 'function');
    await ReactTestRenderer.act(async () => {
      input!.props.onChangeText('999');
    });

    const updatedInput = root.findAllByProps({ testID: 'depth-picker-input' }).find(match => typeof match.props.onSubmitEditing === 'function');
    await ReactTestRenderer.act(async () => {
      updatedInput!.props.onSubmitEditing();
    });

    expect(onChange).toHaveBeenCalledWith(40);
    expect(root.findByProps({ testID: 'depth-picker-value' }).props.children).toBe('40');
  });

  it('does not emit scroll or open input while disabled', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumberWheelPicker value={10} min={0} max={20} step={5} unitLabel="m" disabled onChange={onChange} testID="depth-picker" />,
      );
    });
    renderers.push(renderer!);

    const root = renderer!.root;
    const list = root.findByProps({ testID: 'depth-picker-wheel-list' });

    await ReactTestRenderer.act(async () => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: ITEM_HEIGHT * 3 } } });
      root.findByProps({ testID: 'depth-picker-input-trigger' }).props.onPress();
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(root.findAllByProps({ testID: 'depth-picker-input' })).toHaveLength(0);
    expect(root.findByProps({ testID: 'depth-picker-value' }).props.children).toBe('10');
  });

  it('passes pickerHeight from NumericSliderField to NumberWheelPicker height', async () => {
    const onChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <NumericSliderField
          label="Maximum depth"
          value={10}
          min={0}
          max={20}
          step={5}
          unitLabel="m"
          pickerHeight={132}
          onChange={onChange}
          testID="depth-picker"
        />,
      );
    });
    renderers.push(renderer!);

    const wheel = renderer!.root.findByProps({ testID: 'depth-picker-wheel' });
    const list = renderer!.root.findByProps({ testID: 'depth-picker-wheel-list' });

    expect(wheel.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ height: 132 })]));
    expect(list.props.contentContainerStyle).toEqual(expect.arrayContaining([expect.objectContaining({ paddingVertical: 48 })]));
  });
});
