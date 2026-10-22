import React from 'react';
import { AccessibilityInfo } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  APP_FEEDBACK_DISMISS_MS,
  AppFeedbackProvider,
  useAppFeedback,
} from '../src/components/feedback/app-feedback';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

let notify: ReturnType<typeof useAppFeedback>['notify'] = () => undefined;

function Probe() {
  notify = useAppFeedback().notify;
  return null;
}

async function renderHost() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <AppFeedbackProvider>
        <Probe />
      </AppFeedbackProvider>,
    );
  });
  return renderer!;
}

function messageText(renderer: ReactTestRenderer.ReactTestRenderer): string | undefined {
  const nodes = renderer.root.findAll(node => node.props.testID === 'app-feedback-message');
  return nodes.length ? String(nodes[0]!.props.children) : undefined;
}

describe('AppFeedbackProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows a message once, announces it, and dismisses it after the shared delay', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const renderer = await renderHost();

    await ReactTestRenderer.act(async () => {
      notify('Saved on this device');
    });
    expect(messageText(renderer)).toBe('Saved on this device');
    expect(announce).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(APP_FEEDBACK_DISMISS_MS - 1);
    });
    expect(messageText(renderer)).toBe('Saved on this device');

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(messageText(renderer)).toBeUndefined();
  });

  it('replaces the visible message and restarts the delay', async () => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const renderer = await renderHost();

    await ReactTestRenderer.act(async () => {
      notify('First');
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(APP_FEEDBACK_DISMISS_MS - 500);
      notify('Second', 'attention');
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1_000);
    });

    expect(messageText(renderer)).toBe('Second');
    const banner = renderer.root.findAll(node => node.props.testID === 'app-feedback' && node.props.accessibilityRole)[0]!;
    expect(banner.props.accessibilityRole).toBe('alert');
  });

  it('is a silent no-op outside the provider', () => {
    let fallback: ReturnType<typeof useAppFeedback> | undefined;
    function Outside() {
      fallback = useAppFeedback();
      return null;
    }
    ReactTestRenderer.act(() => {
      ReactTestRenderer.create(<Outside />);
    });
    expect(() => fallback!.notify('ignored')).not.toThrow();
  });
});
