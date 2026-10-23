import React from 'react';
import { AccessibilityInfo } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { FadeInDown } from 'react-native-reanimated';
import { Text } from 'react-native';
import { APP_FEEDBACK_DISMISS_MS, AppFeedbackProvider, useAppFeedback } from '../src/components/feedback/app-feedback';
import { FeedbackLayer } from '../src/components/feedback/feedback-layer';
import { appearEntering } from '../src/components/ui/motion-entering';
import { MOTION_DISTANCE, MOTION_TIMING } from '../src/constants/motion';
import { useFirstLoadReveal } from '../src/hooks/use-first-load-reveal';
import { useLeavingValue } from '../src/hooks/use-leaving-value';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

type Renderer = ReactTestRenderer.ReactTestRenderer;

let notify: ReturnType<typeof useAppFeedback>['notify'] = () => undefined;

function Probe() {
  notify = useAppFeedback().notify;
  return null;
}

/** Host nodes only: the native element that carries the prop, not the composite wrapper. */
function hosts(renderer: Renderer, predicate: (props: Record<string, unknown>) => boolean) {
  return renderer.root.findAll(node => typeof node.type === 'string' && predicate(node.props));
}

async function renderBanner(): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <AppFeedbackProvider>
        <Probe />
      </AppFeedbackProvider>,
    );
  });
  return renderer!;
}

describe('motion helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('an arriving banner or toast rises the spec offset while it brightens', () => {
    const withInitialValues = jest.spyOn(FadeInDown, 'withInitialValues');

    expect(appearEntering(false)).toBeDefined();
    expect(withInitialValues).toHaveBeenCalledWith({ transform: [{ translateY: MOTION_DISTANCE.appearOffset }] });
  });

  test('under Reduce Motion an arriving layer is opacity only, with no movement', () => {
    const withInitialValues = jest.spyOn(FadeInDown, 'withInitialValues');

    expect(appearEntering(true, 80)).toBeDefined();
    expect(withInitialValues).not.toHaveBeenCalled();
  });

  test('useFirstLoadReveal reports the handover from a first-load skeleton for the fade time only', () => {
    jest.useFakeTimers();
    const seen: boolean[] = [];
    function Reveal(props: { isFirstLoad: boolean }) {
      seen.push(useFirstLoadReveal(props.isFirstLoad));
      return null;
    }

    let renderer: Renderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<Reveal isFirstLoad />);
    });
    ReactTestRenderer.act(() => {
      renderer!.update(<Reveal isFirstLoad={false} />);
    });

    // The handover render reports true; the flag holds for the fade and then clears.
    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(true);
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(MOTION_TIMING.fade);
    });
    expect(seen[seen.length - 1]).toBe(false);
    expect(seen.filter(Boolean)).toHaveLength(1);
    jest.useRealTimers();
  });

  test('useFirstLoadReveal stays false for content that was already shown', () => {
    const seen: boolean[] = [];
    function Reveal(props: { isFirstLoad: boolean }) {
      seen.push(useFirstLoadReveal(props.isFirstLoad));
      return null;
    }

    // A refetch of a list already on screen keeps isFirstLoad false, so it never reveals.
    let renderer: Renderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<Reveal isFirstLoad={false} />);
    });
    ReactTestRenderer.act(() => {
      renderer!.update(<Reveal isFirstLoad={false} />);
    });
    ReactTestRenderer.act(() => {
      renderer!.update(<Reveal isFirstLoad={false} />);
    });

    expect(seen.every(value => value === false)).toBe(true);
  });

  test('useLeavingValue holds the replaced value for the dismiss time only', () => {
    jest.useFakeTimers();
    const seen: Array<string | undefined> = [];
    function Leaving(props: { value: string | undefined }) {
      seen.push(useLeavingValue(props.value, MOTION_TIMING.dismiss));
      return null;
    }

    let renderer: Renderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<Leaving value="first" />);
    });
    ReactTestRenderer.act(() => {
      renderer!.update(<Leaving value="second" />);
    });
    expect(seen[seen.length - 1]).toBe('first');

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(MOTION_TIMING.dismiss);
    });
    expect(seen[seen.length - 1]).toBeUndefined();
    jest.useRealTimers();
  });
});

describe('FeedbackLayer', () => {
  test('an arriving layer has an entering animation and takes touches', () => {
    let renderer: Renderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <FeedbackLayer testID="layer">
          <Text>Saved</Text>
        </FeedbackLayer>,
      );
    });

    const [layer] = hosts(renderer!, props => props.testID === 'layer');
    expect(layer!.props.entering).toBeDefined();
    expect(layer!.props.pointerEvents).toBe('box-none');
    expect(layer!.props.accessibilityElementsHidden).toBeFalsy();
  });

  test('a leaving layer takes no touches, is hidden from VoiceOver, and does not enter', () => {
    let renderer: Renderer | undefined;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <FeedbackLayer testID="layer" leaving>
          <Text>Saved</Text>
        </FeedbackLayer>,
      );
    });

    const [layer] = hosts(renderer!, props => props.testID === 'layer');
    expect(layer!.props.pointerEvents).toBe('none');
    expect(layer!.props.accessibilityElementsHidden).toBe(true);
    expect(layer!.props.entering).toBeUndefined();
  });
});

describe('AppFeedbackProvider motion', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('a replaced message leaves as an inert copy, and a closed message cannot be pressed while it fades', async () => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const renderer = await renderBanner();

    await ReactTestRenderer.act(async () => {
      notify('First');
    });
    const [arriving] = hosts(renderer, props => props.testID === 'app-feedback');
    expect(arriving).toBeDefined();
    expect(hosts(renderer, props => props.pointerEvents === 'none')).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      notify('Second');
    });
    // The replaced copy keeps fading, but it is inert: no test ID, no touches, hidden from VoiceOver.
    const leaving = hosts(renderer, props => props.pointerEvents === 'none');
    expect(leaving).toHaveLength(1);
    expect(leaving[0]!.props.accessibilityElementsHidden).toBe(true);
    expect(leaving[0]!.findAll(node => node.props.children === 'First').length).toBeGreaterThan(0);
    expect(hosts(renderer, props => props.testID === 'app-feedback')).toHaveLength(1);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(MOTION_TIMING.dismiss);
    });
    expect(hosts(renderer, props => props.pointerEvents === 'none')).toHaveLength(0);
  });

  test('tapping the banner closes it at once and leaves an inert copy for the dismiss time', async () => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const renderer = await renderBanner();

    await ReactTestRenderer.act(async () => {
      notify('Saved on this device');
    });
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'app-feedback' }).props.onPress();
    });

    expect(hosts(renderer, props => props.testID === 'app-feedback')).toHaveLength(0);
    expect(hosts(renderer, props => props.pointerEvents === 'none')).toHaveLength(1);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(APP_FEEDBACK_DISMISS_MS);
    });
    expect(hosts(renderer, props => props.pointerEvents === 'none')).toHaveLength(0);
  });
});
