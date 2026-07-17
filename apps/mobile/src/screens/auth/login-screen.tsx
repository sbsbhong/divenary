import { AppleButton } from '@invertase/react-native-apple-authentication';
import { GoogleSigninButton } from '@react-native-google-signin/google-signin';
import React from 'react';
import type { ViewProps } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Box } from '../../components/ui/box';
import { Button, ButtonIcon } from '../../components/ui/button';
import { CloseIcon } from '../../components/ui/icon';
import { SafeAreaView } from '../../components/ui/safe-area-view';
import { ScrollView } from '../../components/ui/scroll-view';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { SocialProvider } from '../../auth/native-social-auth';
import { useAuth } from '../../states/auth';

type LoginScreenProps = {
  onClose?: () => void;
};

type AccessibleAppleButtonProps = React.ComponentProps<typeof AppleButton> &
  Pick<ViewProps, 'accessibilityLabel' | 'accessibilityRole' | 'accessibilityState' | 'pointerEvents'> & {
    disabled?: boolean;
  };

const NativeAppleButton = AppleButton as React.ComponentType<AccessibleAppleButtonProps>;

const nativeProviderButtonStyle = {
  height: 52,
  width: '100%' as const,
};

export default function LoginScreen({ onClose }: LoginScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const auth = useAuth();
  const [isBusy, setIsBusy] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);
  const actionInFlight = React.useRef(false);
  const providers = auth.isConfigured ? auth.availableProviders : [];
  const recentLabel = t('auth.login.recent');

  const signIn = React.useCallback(
    async (provider: SocialProvider) => {
      if (actionInFlight.current) {
        return;
      }

      actionInFlight.current = true;
      setIsBusy(true);
      setHasError(false);

      try {
        await auth.signIn(provider);
      } catch {
        setHasError(true);
      } finally {
        actionInFlight.current = false;
        setIsBusy(false);
      }
    },
    [auth],
  );

  return (
    <SafeAreaView testID="auth-login-safe-area" edges={['bottom']} className="flex-1 bg-background">
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        <VStack testID="auth-login-screen" space="2xl" className="px-5 pb-10 pt-4">
          <Box className="relative min-h-11 justify-center">
            <Text className="px-14 text-center text-2xl font-semibold leading-8 text-foreground">{t('auth.login.title')}</Text>
            {onClose ? (
              <Button
                testID="auth-login-close"
                accessibilityLabel={t('auth.login.close')}
                accessibilityRole="button"
                accessibilityState={{ disabled: isBusy }}
                className="absolute right-0 h-11 w-11 rounded-full bg-muted"
                disabled={isBusy}
                onPress={onClose}
                size="icon"
                variant="ghost">
                <ButtonIcon as={CloseIcon} className="text-foreground" />
              </Button>
            ) : null}
          </Box>

          {providers.length > 0 ? (
            <VStack space="md">
              {providers.includes('google') ? (
                <ProviderControl provider="google" recent={auth.recentProvider === 'google'}>
                  <GoogleSigninButton
                    testID="auth-login-google"
                    accessibilityLabel={getProviderAccessibilityLabel(
                      t('auth.login.googleAccessibilityLabel'),
                      auth.recentProvider === 'google',
                      recentLabel,
                    )}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isBusy }}
                    color={GoogleSigninButton.Color.Light}
                    disabled={isBusy}
                    onPress={() => signIn('google')}
                    size={GoogleSigninButton.Size.Wide}
                    style={nativeProviderButtonStyle}
                  />
                </ProviderControl>
              ) : null}

              {providers.includes('apple') ? (
                <ProviderControl provider="apple" recent={auth.recentProvider === 'apple'}>
                  <NativeAppleButton
                    testID="auth-login-apple"
                    accessibilityLabel={getProviderAccessibilityLabel(
                      t('auth.login.appleAccessibilityLabel'),
                      auth.recentProvider === 'apple',
                      recentLabel,
                    )}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isBusy }}
                    buttonStyle={AppleButton.Style.WHITE}
                    buttonType={AppleButton.Type.CONTINUE}
                    cornerRadius={8}
                    disabled={isBusy}
                    onPress={() => signIn('apple')}
                    pointerEvents={isBusy ? 'none' : 'auto'}
                    style={nativeProviderButtonStyle}
                  />
                </ProviderControl>
              ) : null}
            </VStack>
          ) : (
            <Box className="rounded-2xl bg-muted px-4 py-4">
              <Text className="text-center text-base font-semibold text-foreground">{t('auth.login.unavailableTitle')}</Text>
            </Box>
          )}

          {providers.length > 0 ? (
            <Text className="text-center text-sm leading-5 text-muted-foreground">{t('auth.login.guestBoundaryNote')}</Text>
          ) : null}

          {hasError ? (
            <Box className="rounded-2xl bg-destructive/10 px-4 py-3">
              <Text testID="auth-login-error" accessibilityRole="alert" className="text-center text-sm leading-5 text-destructive">
                {t('auth.login.error')}
              </Text>
            </Box>
          ) : null}
        </VStack>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProviderControl({
  children,
  provider,
  recent,
}: {
  children: React.ReactNode;
  provider: SocialProvider;
  recent: boolean;
}): React.JSX.Element {
  return (
    <Box className="relative">
      {children}
      {recent ? (
        <Box
          testID={`auth-login-recent-${provider}`}
          accessible={false}
          pointerEvents="none"
          className="absolute right-1 top-1 h-3 w-3 rounded-full bg-primary"
        />
      ) : null}
    </Box>
  );
}

function getProviderAccessibilityLabel(baseLabel: string, recent: boolean, recentLabel: string): string {
  return recent ? `${baseLabel}, ${recentLabel}` : baseLabel;
}
