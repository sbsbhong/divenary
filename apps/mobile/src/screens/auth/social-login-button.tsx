import React from 'react';
import { Platform } from 'react-native';

import type { SocialProvider } from '../../auth/native-social-auth';
import { Box } from '../../components/ui/box';
import { Image } from '../../components/ui/image';
import { Pressable } from '../../components/ui/pressable';
import { Spinner } from '../../components/ui/spinner';
import { Text } from '../../components/ui/text';

export type SocialLoginButtonProps = {
  provider: SocialProvider;
  label: string;
  accessibilityLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
};

const providerLogo = {
  google: require('../../assets/auth/google-g-logo.png'),
  apple: require('../../assets/auth/apple-sign-in-logo.png'),
} as const;

export function SocialLoginButton(props: SocialLoginButtonProps): React.JSX.Element {
  const slotWidth = Platform.OS === 'ios' ? 52 : 44;
  const isGoogle = props.provider === 'google';

  return (
    <Pressable
      testID={`auth-login-${props.provider}`}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: props.busy, disabled: props.disabled }}
      className="w-full flex-row items-center border bg-white active:opacity-70"
      disabled={props.disabled}
      onPress={props.onPress}
      style={{ height: 44, borderColor: '#747775', borderRadius: 8 }}>
      <Box testID={`auth-login-${props.provider}-icon-slot`} className="items-center justify-center" style={{ width: slotWidth }}>
        <Image
          testID={`auth-login-${props.provider}-logo`}
          accessible={false}
          alt=""
          source={providerLogo[props.provider]}
          size="none"
          resizeMode="contain"
          style={isGoogle ? { height: 20, width: 20 } : { height: 44, width: 44 }}
        />
      </Box>
      <Text
        testID={`auth-login-${props.provider}-label`}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.5}
        minimumFontScale={0.8}
        numberOfLines={1}
        className="flex-1 text-center text-black"
        style={
          isGoogle
            ? { color: '#1f1f1f', fontFamily: 'Google Sans', fontSize: 14, lineHeight: 20 }
            : { color: '#000000', fontSize: 19, fontWeight: '500', lineHeight: 23 }
        }>
        {props.label}
      </Text>
      <Box
        testID={`auth-login-${props.provider}-status-slot`}
        className="items-center justify-center"
        style={{ width: slotWidth }}>
        {props.busy ? (
          <Spinner
            testID={`auth-login-spinner-${props.provider}`}
            aria-label={props.busyLabel}
            color="#5f6368"
            size="small"
          />
        ) : null}
      </Box>
    </Pressable>
  );
}
