import React from 'react';
import { Platform } from 'react-native';

import type { SocialProvider } from '../../auth/native-social-auth';
import { Box } from '../../components/ui/box';
import { Image } from '../../components/ui/image';
import { Pressable } from '../../components/ui/pressable';
import { Spinner } from '../../components/ui/spinner';
import { Text } from '../../components/ui/text';
import { useLoadingFeedback } from '../../hooks/use-loading-feedback';

export type SocialLoginButtonTheme = 'light' | 'dark';

export type SocialLoginButtonProps = {
  provider: SocialProvider;
  label: string;
  accessibilityLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  /** The resolved app theme; the provider buttons follow Apple and Google brand rules for it. */
  theme?: SocialLoginButtonTheme;
  /** Set on the provider used for the last sign-in: shown as a small tag on the button's corner. */
  recentLabel?: string;
};

type ButtonColors = {
  background: string;
  border?: string;
  label: string;
  spinner: string;
};

// The two buttons are drawn as one matched pair: the same pill, height, label size and logo slot,
// and the same polarity from each brand's own palette — dark buttons on the light sheet (Apple
// black, Google's #131314 dark theme) and light buttons on the dark sheet (Apple white, Google's
// light theme).
const buttonColors: Record<SocialProvider, Record<SocialLoginButtonTheme, ButtonColors>> = {
  apple: {
    light: { background: '#000000', label: '#FFFFFF', spinner: '#FFFFFF' },
    dark: { background: '#FFFFFF', label: '#000000', spinner: '#000000' },
  },
  google: {
    light: { background: '#131314', border: '#8E918F', label: '#E3E3E3', spinner: '#E3E3E3' },
    dark: { background: '#FFFFFF', border: '#747775', label: '#1F1F1F', spinner: '#5F6368' },
  },
};

const BUTTON_HEIGHT = 50;
const LABEL_STYLE = { fontSize: 17, lineHeight: 22 } as const;

// The official Apple artwork has an opaque square behind the logo, so each button colour gets
// the matching artwork: a black logo on white, and the same logo inverted for the black button.
const providerLogo = {
  google: require('../../assets/auth/google-g-logo.png'),
  apple: {
    light: require('../../assets/auth/apple-sign-in-logo-black.png'),
    dark: require('../../assets/auth/apple-sign-in-logo.png'),
  },
} as const;

export function SocialLoginButton(props: SocialLoginButtonProps): React.JSX.Element {
  const theme = props.theme ?? 'light';
  const colors = buttonColors[props.provider][theme];
  const slotWidth = Platform.OS === 'ios' ? 52 : 44;
  const isGoogle = props.provider === 'google';
  // The button is disabled and busy at once; the spinner waits for the shared 1 s delay.
  const { showIndicator } = useLoadingFeedback(props.busy);
  const logo = (
    <Image
      testID={`auth-login-${props.provider}-logo`}
      accessible={false}
      alt=""
      source={isGoogle ? providerLogo.google : providerLogo.apple[theme]}
      size="none"
      resizeMode="contain"
      style={
        isGoogle
          ? { height: 20, width: 20 }
          : { height: 44, left: -10, maxWidth: 44, position: 'absolute', top: -10, width: 44 }
      }
    />
  );

  return (
    <Box className="w-full">
    <Pressable
      testID={`auth-login-${props.provider}`}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: props.busy, disabled: props.disabled }}
      className="w-full flex-row items-center active:scale-95"
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderRadius: BUTTON_HEIGHT / 2,
        borderWidth: colors.border ? 1 : 0,
        height: BUTTON_HEIGHT,
        // Only the provider the user did not pick dims; the picked one stays solid.
        opacity: props.disabled && !props.busy ? 0.5 : 1,
      }}>
      <Box testID={`auth-login-${props.provider}-icon-slot`} className="items-center justify-center" style={{ width: slotWidth }}>
        {isGoogle ? (
          logo
        ) : (
          <Box
            testID="auth-login-apple-logo-viewport"
            className="items-center justify-center"
            style={{ height: 24, overflow: 'hidden', width: 24 }}>
            {logo}
          </Box>
        )}
      </Box>
      <Text
        testID={`auth-login-${props.provider}-label`}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.5}
        minimumFontScale={0.8}
        numberOfLines={1}
        className="flex-1 text-center"
        style={
          isGoogle
            ? { ...LABEL_STYLE, color: colors.label, fontFamily: 'GoogleSans-Medium' }
            : { ...LABEL_STYLE, color: colors.label, fontWeight: '600' }
        }>
        {props.label}
      </Text>
      <Box
        testID={`auth-login-${props.provider}-status-slot`}
        className="items-center justify-center"
        style={{ width: slotWidth }}>
        {showIndicator ? (
          <Spinner
            testID={`auth-login-spinner-${props.provider}`}
            aria-label={props.busyLabel}
            color={colors.spinner}
            size="small"
          />
        ) : null}
      </Box>
    </Pressable>
      {props.recentLabel ? (
        // Outside the button so the brand artwork and label stay as the brands draw them; the
        // button's accessibility label already says it was used last.
        <Box
          testID={`auth-login-recent-${props.provider}`}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute -top-2.5 right-6 rounded-full bg-card px-2.5 py-0.5">
          <Text maxFontSizeMultiplier={1.3} className="text-xs font-semibold text-card-foreground">
            {props.recentLabel}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
