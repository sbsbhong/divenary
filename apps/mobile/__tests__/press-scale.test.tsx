import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { View, type GestureResponderEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { PressScaleButton, PressScalePressable } from '../src/components/ui/press-scale';
import { PRESS_SCALE, type PressScaleKind } from '../src/constants/motion';
import { usePressScale, type PressHandlers } from '../src/hooks/use-press-scale';

const reanimated = jest.requireMock<typeof import('react-native-reanimated')>('react-native-reanimated');

// The reanimated mock builds a new shared value on every render, so a press could never carry over
// to the next render. A stable cell per component, as the real hook keeps, lets these tests re-render.
beforeAll(() => {
  jest.spyOn(reanimated, 'useSharedValue').mockImplementation(((initial: unknown) => {
    const [cell] = React.useState(() => {
      const next = {
        value: initial,
        get: () => next.value,
        set: (value: unknown) => {
          next.value = value;
        },
      };
      return next;
    });
    return cell;
  }) as typeof reanimated.useSharedValue);
});

afterAll(() => {
  jest.restoreAllMocks();
});

type Press = ReturnType<typeof usePressScale>;

function ScaleProbe(props: { kind: PressScaleKind; handlers?: PressHandlers; press: { current?: Press } }) {
  const press = usePressScale(props.kind, props.handlers);
  props.press.current = press;
  return <Animated.View style={press.style} />;
}

/** The mock runs animations to their end value, so the scale is read after a render. */
function renderProbe(kind: PressScaleKind, handlers?: PressHandlers) {
  const press: { current?: Press } = {};
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<ScaleProbe kind={kind} handlers={handlers} press={press} />);
  });
  const rerender = () =>
    ReactTestRenderer.act(() => {
      renderer!.update(<ScaleProbe kind={kind} handlers={handlers} press={press} />);
    });
  const scale = () => {
    const style = renderer!.root.findByType(Animated.View).props.style as { transform: Array<{ scale: number }> };
    return style.transform[0].scale;
  };
  return { press, rerender, scale };
}

const event = { nativeEvent: { locationX: 4 } } as unknown as GestureResponderEvent;

describe('usePressScale', () => {
  test('shrinks a control on press-in and springs back on release', () => {
    const { press, rerender, scale } = renderProbe('control');
    expect(scale()).toBe(1);

    ReactTestRenderer.act(() => press.current!.onPressIn(event));
    rerender();
    expect(scale()).toBe(PRESS_SCALE.control);

    ReactTestRenderer.act(() => press.current!.onPressOut(event));
    rerender();
    expect(scale()).toBe(1);
  });

  test('shrinks a card less than a control', () => {
    const { press, rerender, scale } = renderProbe('card');

    ReactTestRenderer.act(() => press.current!.onPressIn(event));
    rerender();

    expect(scale()).toBe(PRESS_SCALE.card);
    expect(PRESS_SCALE.card).toBeGreaterThan(PRESS_SCALE.control);
  });

  test('still calls the caller press handlers with the same event', () => {
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    const { press } = renderProbe('control', { onPressIn, onPressOut });

    ReactTestRenderer.act(() => press.current!.onPressIn(event));
    ReactTestRenderer.act(() => press.current!.onPressOut(event));

    expect(onPressIn).toHaveBeenCalledWith(event);
    expect(onPressOut).toHaveBeenCalledWith(event);
  });
});

describe('press scale components', () => {
  test('PressScalePressable keeps its testID, accessibility, caller style and onPress', () => {
    const onPress = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <PressScalePressable
          kind="card"
          testID="row"
          accessibilityRole="button"
          accessibilityLabel="Open"
          style={{ bottom: 12 }}
          onPress={onPress}>
          <View />
        </PressScalePressable>,
      );
    });
    const host = renderer!.root.findAll(node => (node.type as unknown) === 'View' && node.props.testID === 'row')[0]!;

    expect(host.props.accessibilityRole).toBe('button');
    expect(host.props.accessibilityLabel).toBe('Open');
    expect(JSON.stringify(host.props.style)).toContain('"bottom":12');
    expect(JSON.stringify(host.props.style)).toContain('"scale":1');

    ReactTestRenderer.act(() => {
      renderer!.root.findByProps({ testID: 'row' }).props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('a disabled PressScaleButton never answers a press, so it never shrinks', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <PressScaleButton kind="control" testID="disabled-control" disabled onPress={jest.fn()}>
          {null}
        </PressScaleButton>,
      );
    });
    const host = renderer!.root.findAll(
      node => (node.type as unknown) === 'View' && node.props.testID === 'disabled-control',
    )[0]!;

    expect(host.props.onStartShouldSetResponder?.()).toBe(false);
    expect(host.props.accessibilityState).toMatchObject({ disabled: true });
  });
});
