import React from 'react';

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
  recentLabel?: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
};

const providerLogo = {
  google: require('../../assets/auth/google-g-logo.png'),
  apple: require('../../assets/auth/apple-sign-in-logo.png'),
} as const;

export function SocialLoginButton(props: SocialLoginButtonProps): React.JSX.Element {
  return (
    <Pressable
      testID={`auth-login-${props.provider}`}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: props.busy, disabled: props.disabled }}
      className="w-full flex-row items-center border bg-white px-2 active:opacity-70"
      disabled={props.disabled}
      onPress={props.onPress}
      style={{ height: 54, borderColor: '#747775', borderRadius: 8 }}>
      <Box testID={`auth-login-${props.provider}-icon-slot`} className="w-11 items-center justify-center">
        <Image
          accessible={false}
          alt=""
          source={providerLogo[props.provider]}
          size="none"
          className="h-6 w-6"
        />
      </Box>
      <Text className="flex-1 text-center text-sm font-semibold text-black">{props.label}</Text>
      <Box testID={`auth-login-${props.provider}-status-slot`} className="w-11 items-center justify-center">
        {props.busy ? (
          <Spinner
            testID={`auth-login-spinner-${props.provider}`}
            aria-label={props.busyLabel}
            color="#007aff"
            size="small"
          />
        ) : props.recentLabel ? (
          <Text testID={`auth-login-recent-${props.provider}`} className="text-[11px] font-bold text-primary">
            {props.recentLabel}
          </Text>
        ) : null}
      </Box>
    </Pressable>
  );
}
