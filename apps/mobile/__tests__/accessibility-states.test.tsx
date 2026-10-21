import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenBackButton, SelectorPill } from '../src/components/ui/instrument';
import { NumberWheelPicker } from '../src/components/ui/number-wheel-picker';
import i18n from '../src/i18n';
import { StarRatingField } from '../src/screens/common/form/star-rating-field';

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

async function render(element: React.JSX.Element): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  renderers.push(renderer!);
  return renderer!;
}

function hostWith(
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
  prop: string,
): ReactTestRenderer.ReactTestInstance | undefined {
  return renderer.root.findAll(node => node.props.testID === testID && node.props[prop] !== undefined)[0];
}

describe('accessibility states', () => {
  beforeEach(async () => {
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  test('selector pills expose their selected state with a 44 pt target', async () => {
    const renderer = await render(<SelectorPill testID="pill" label="전체" selected onPress={jest.fn()} />);

    expect(hostWith(renderer, 'pill', 'accessibilityState')?.props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(String(hostWith(renderer, 'pill', 'className')?.props.className)).toContain('min-h-11');
  });

  test('star rating names each star out of five and marks the chosen value', async () => {
    const renderer = await render(<StarRatingField label="평점" value={3} onChange={jest.fn()} testID="rating" />);
    const third = hostWith(renderer, 'rating-star-3', 'accessibilityLabel');
    const fourth = hostWith(renderer, 'rating-star-4', 'accessibilityLabel');

    expect(third?.props.accessibilityLabel).toBe('5점 중 3점');
    expect(third?.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(fourth?.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
  });

  test('number wheel supports VoiceOver increment and decrement', async () => {
    const onChange = jest.fn();
    const renderer = await render(
      <NumberWheelPicker value={10} min={0} max={20} step={1} unitLabel="m" onChange={onChange} testID="wheel" />,
    );
    const root = hostWith(renderer, 'wheel', 'accessibilityActions');

    expect(root?.props.accessibilityActions).toEqual(
      expect.arrayContaining([{ name: 'increment' }, { name: 'decrement' }]),
    );
    expect(root?.props.accessibilityLabel).toBe('숫자 선택, m');

    await ReactTestRenderer.act(async () => {
      root?.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    });
    expect(onChange).toHaveBeenLastCalledWith(11);
  });

  test('screen back buttons meet the 44 pt target', async () => {
    const renderer = await render(<ScreenBackButton testID="back" accessibilityLabel="뒤로" onPress={jest.fn()} />);

    expect(String(hostWith(renderer, 'back', 'className')?.props.className)).toContain('h-11 w-11');
  });
});
