import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { CONTENT_LOADING_FEEDBACK } from '../src/constants/async-feedback';
import { DetailSkeleton } from '../src/components/ui/detail-skeleton';
import i18n from '../src/i18n';

async function render(element: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer!;
}

/** Host views of every skeleton line (they are the only nodes hidden from accessibility). */
function skeletonLines(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    node => typeof node.type === 'string' && node.props.accessibilityElementsHidden === true,
  );
}

function hostClassNames(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll(node => typeof node.type === 'string' && typeof node.props.className === 'string')
    .map(node => node.props.className as string);
}

describe('DetailSkeleton', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await ReactTestRenderer.act(async () => {
      await i18n.changeLanguage('ko');
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reserves the title, summary group and three rows but shows nothing before the delay', async () => {
    const renderer = await render(<DetailSkeleton />);

    expect(renderer.root.findByProps({ testID: 'detail-skeleton' }).props.accessibilityState).toEqual({ busy: true });
    // Title, three facts with a label and a value each, three rows with a label and a value each.
    expect(skeletonLines(renderer)).toHaveLength(1 + 3 * 2 + 3 * 2);
    expect(skeletonLines(renderer).every(node => String(node.props.className).includes('opacity-0'))).toBe(true);
    expect(hostClassNames(renderer).some(className => className.includes('bg-card'))).toBe(false);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(CONTENT_LOADING_FEEDBACK.indicatorMs - 1);
    });
    expect(skeletonLines(renderer).every(node => String(node.props.className).includes('opacity-0'))).toBe(true);
  });

  it('shows the lines and their card surfaces together after the delay', async () => {
    const renderer = await render(<DetailSkeleton />);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(CONTENT_LOADING_FEEDBACK.indicatorMs);
    });

    expect(skeletonLines(renderer).every(node => String(node.props.className).includes('opacity-100'))).toBe(true);
    expect(hostClassNames(renderer).filter(className => className.includes('bg-card'))).toHaveLength(2);
    expect(renderer.root.findAll(node => node.props.accessibilityLabel === '내용을 불러오는 중').length).toBeGreaterThan(0);
    expect(hostClassNames(renderer).some(className => /shadow-|border /.test(className))).toBe(false);
  });

  it('keeps the real back control usable from the start', async () => {
    const onBack = jest.fn();
    const renderer = await render(<DetailSkeleton onBack={onBack} />);
    const back = renderer.root.findByProps({ testID: 'detail-skeleton-back' });

    expect(back.props.accessibilityLabel).toBe('뒤로');
    await ReactTestRenderer.act(async () => {
      back.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
