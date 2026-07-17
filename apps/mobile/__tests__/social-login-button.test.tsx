import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { SocialLoginButton } from '../src/screens/auth/social-login-button';

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

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
  });

  test.each(['google', 'apple'] as const)('renders a fixed unified %s row', async provider => {
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

    expect(style).toMatchObject({ height: 54, borderRadius: 8 });
    expect(renderer.root.findByProps({ testID: `auth-login-${provider}-icon-slot` }).props.className).toContain('w-11');
    expect(renderer.root.findByProps({ testID: `auth-login-${provider}-status-slot` }).props.className).toContain('w-11');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityState).toEqual({ busy: false, disabled: false });
  });

  test('uses the fixed status slot for recent and busy states', async () => {
    const onPress = jest.fn();
    const renderer = await render(
      <SocialLoginButton
        provider="google"
        label="Google로 계속"
        accessibilityLabel="Google로 계속하기, 최근 사용"
        busyLabel="로그인 중"
        recentLabel="최근"
        busy={false}
        disabled={false}
        onPress={onPress}
      />,
    );

    expect(renderer.root.findByProps({ testID: 'auth-login-recent-google' }).props.children).toBe('최근');

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
          recentLabel="최근"
          busy
          disabled
          onPress={onPress}
        />,
      );
    });

    expect(renderer.root.findAllByProps({ testID: 'auth-login-recent-google' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'auth-login-spinner-google' }).props['aria-label']).toBe('로그인 중');
  });
});
