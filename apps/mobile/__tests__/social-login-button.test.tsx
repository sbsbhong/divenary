import React from 'react';
import { Image as NativeImage, Platform, StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { SocialLoginButton } from '../src/screens/auth/social-login-button';

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];
const originalPlatformOS = Object.getOwnPropertyDescriptor(Platform, 'OS');

function setPlatformOS(platformOS: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: platformOS,
  });
}

async function render(element: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  mountedRenderers.push(renderer!);

  return renderer!;
}

describe('SocialLoginButton', () => {
  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      for (const renderer of mountedRenderers.splice(0)) {
        renderer.unmount();
      }
    });

    if (originalPlatformOS) {
      Object.defineProperty(Platform, 'OS', originalPlatformOS);
    } else {
      Reflect.deleteProperty(Platform, 'OS');
    }
  });

  test.each(['google', 'apple'] as const)('renders a unified 44-point %s row', async provider => {
    const renderer = await render(
      <SocialLoginButton
        provider={provider}
        label={`Continue with ${provider}`}
        accessibilityLabel={`Continue with ${provider}`}
        busyLabel="Signing in"
        busy={false}
        disabled={false}
        onPress={jest.fn()}
      />,
    );
    const button = renderer.root.findByProps({ testID: `auth-login-${provider}` });
    const style = StyleSheet.flatten(button.props.style);

    expect(style).toMatchObject({ height: 44, borderRadius: 8 });
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityState).toEqual({ busy: false, disabled: false });
  });

  test('preserves official provider artwork proportions and text sizing', async () => {
    const google = await render(
      <SocialLoginButton
        provider="google"
        label="Continue with Google"
        accessibilityLabel="Continue with Google"
        busyLabel="Signing in"
        busy={false}
        disabled={false}
        onPress={jest.fn()}
      />,
    );
    const apple = await render(
      <SocialLoginButton
        provider="apple"
        label="Continue with Apple"
        accessibilityLabel="Continue with Apple"
        busyLabel="Signing in"
        busy={false}
        disabled={false}
        onPress={jest.fn()}
      />,
    );
    const googleLogo = google.root.findAllByType(NativeImage).find(node => node.props.testID === 'auth-login-google-logo');
    const appleLogo = apple.root.findAllByType(NativeImage).find(node => node.props.testID === 'auth-login-apple-logo');
    const appleLogoViewport = apple.root.findByProps({ testID: 'auth-login-apple-logo-viewport' });
    const googleLabel = google.root.findByProps({ testID: 'auth-login-google-label' });
    const appleLabel = apple.root.findByProps({ testID: 'auth-login-apple-label' });

    expect(StyleSheet.flatten(googleLogo?.props.style)).toMatchObject({ height: 20, width: 20 });
    expect(googleLogo?.props.resizeMode).toBe('contain');
    expect(StyleSheet.flatten(appleLogo?.props.style)).toMatchObject({
      height: 44,
      left: -10,
      maxWidth: 44,
      position: 'absolute',
      top: -10,
      width: 44,
    });
    expect(appleLogo?.props.resizeMode).toBe('contain');
    expect(StyleSheet.flatten(appleLogoViewport.props.style)).toMatchObject({
      height: 24,
      overflow: 'hidden',
      width: 24,
    });
    expect(StyleSheet.flatten(googleLabel.props.style)).toMatchObject({
      fontFamily: 'GoogleSans-Medium',
      fontSize: 14,
      lineHeight: 20,
    });
    expect(StyleSheet.flatten(appleLabel.props.style)).toMatchObject({ fontSize: 19 });
    expect(googleLabel.props).toMatchObject({ adjustsFontSizeToFit: true, maxFontSizeMultiplier: 1.5, numberOfLines: 1 });
    expect(appleLabel.props).toMatchObject({ adjustsFontSizeToFit: true, maxFontSizeMultiplier: 1.5, numberOfLines: 1 });
  });

  test('is busy at once and shows the status-slot spinner only after 1 s', async () => {
    jest.useFakeTimers();
    try {
      const onPress = jest.fn();
      const renderer = await render(
        <SocialLoginButton
          provider="google"
          label="Google로 계속"
          accessibilityLabel="Google로 계속하기, 최근 사용"
          busyLabel="로그인 중"
          busy={false}
          disabled={false}
          onPress={onPress}
        />,
      );

      await ReactTestRenderer.act(async () => {
        renderer.root.findByProps({ testID: 'auth-login-google' }).props.onPress();
      });
      expect(onPress).toHaveBeenCalledTimes(1);

      await ReactTestRenderer.act(async () => {
        renderer.update(
          <SocialLoginButton
            provider="google"
            label="Google로 계속"
            accessibilityLabel="Google로 계속하기, 최근 사용"
            busyLabel="로그인 중"
            busy
            disabled
            onPress={onPress}
          />,
        );
      });

      const button = renderer.root.findByProps({ testID: 'auth-login-google' });
      expect(button.props.accessibilityState).toEqual({ busy: true, disabled: true });
      expect(button.props.disabled).toBe(true);
      // The picked provider stays solid; only the other one dims.
      expect(StyleSheet.flatten(button.props.style)).toMatchObject({ opacity: 1 });
      expect(renderer.root.findAllByProps({ testID: 'auth-login-spinner-google' })).toHaveLength(0);

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(999);
      });
      expect(renderer.root.findAllByProps({ testID: 'auth-login-spinner-google' })).toHaveLength(0);

      await ReactTestRenderer.act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(renderer.root.findByProps({ testID: 'auth-login-spinner-google' }).props['aria-label']).toBe('로그인 중');
    } finally {
      jest.useRealTimers();
    }
  });

  test('dims a provider that is disabled while another one signs in', async () => {
    const renderer = await render(
      <SocialLoginButton
        provider="apple"
        label="Continue with Apple"
        accessibilityLabel="Continue with Apple"
        busyLabel="Signing in"
        busy={false}
        disabled
        onPress={jest.fn()}
      />,
    );

    expect(StyleSheet.flatten(renderer.root.findByProps({ testID: 'auth-login-apple' }).props.style)).toMatchObject({
      opacity: 0.5,
    });
  });

  test.each([
    ['apple', 'light', { backgroundColor: '#000000', borderWidth: 0 }, '#FFFFFF'],
    ['apple', 'dark', { backgroundColor: '#FFFFFF', borderWidth: 0 }, '#000000'],
    ['google', 'light', { backgroundColor: '#FFFFFF', borderColor: '#747775', borderWidth: 1 }, '#1F1F1F'],
    ['google', 'dark', { backgroundColor: '#131314', borderColor: '#8E918F', borderWidth: 1 }, '#E3E3E3'],
  ] as const)('follows the %s brand colours in the %s theme', async (provider, theme, buttonStyle, labelColor) => {
    const renderer = await render(
      <SocialLoginButton
        provider={provider}
        theme={theme}
        label={`Continue with ${provider}`}
        accessibilityLabel={`Continue with ${provider}`}
        busyLabel="Signing in"
        busy={false}
        disabled={false}
        onPress={jest.fn()}
      />,
    );

    expect(StyleSheet.flatten(renderer.root.findByProps({ testID: `auth-login-${provider}` }).props.style)).toMatchObject(
      buttonStyle,
    );
    expect(StyleSheet.flatten(renderer.root.findByProps({ testID: `auth-login-${provider}-label` }).props.style)).toMatchObject({
      color: labelColor,
    });
  });

  test('pairs each Apple button colour with logo artwork of the same background', async () => {
    const sources: unknown[] = [];
    for (const theme of ['light', 'dark'] as const) {
      const renderer = await render(
        <SocialLoginButton
          provider="apple"
          theme={theme}
          label="Continue with Apple"
          accessibilityLabel="Continue with Apple"
          busyLabel="Signing in"
          busy={false}
          disabled={false}
          onPress={jest.fn()}
        />,
      );
      sources.push(
        renderer.root.findAllByType(NativeImage).find(node => node.props.testID === 'auth-login-apple-logo')?.props.source,
      );
    }

    expect(sources[0]).toBeDefined();
    expect(sources[1]).toBeDefined();
    expect(sources[0]).not.toEqual(sources[1]);
  });

  test.each([
    ['ios', 52],
    ['android', 44],
  ] as const)('uses %s %d-point icon and status slots', async (platformOS, expectedSlotWidth) => {
    setPlatformOS(platformOS);

    for (const provider of ['google', 'apple'] as const) {
      const renderer = await render(
        <SocialLoginButton
          provider={provider}
          label={`Continue with ${provider}`}
          accessibilityLabel={`Continue with ${provider}`}
          busyLabel="Signing in"
          busy={false}
          disabled={false}
          onPress={jest.fn()}
        />,
      );

      expect(StyleSheet.flatten(renderer.root.findByProps({ testID: `auth-login-${provider}-icon-slot` }).props.style)).toMatchObject({
        width: expectedSlotWidth,
      });
      expect(StyleSheet.flatten(renderer.root.findByProps({ testID: `auth-login-${provider}-status-slot` }).props.style)).toMatchObject({
        width: expectedSlotWidth,
      });
    }
  });
});
