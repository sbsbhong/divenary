import { AppleButton } from '@invertase/react-native-apple-authentication';
import { GoogleSigninButton } from '@react-native-google-signin/google-signin';
import React from 'react';
import type { ViewProps } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Box } from '../../components/ui/box';
import { InstrumentButton, StatusPill } from '../../components/ui/instrument';
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
  height: 48,
  width: '100%' as const,
};

export default function LoginScreen({ onClose }: LoginScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const auth = useAuth();
  const [isBusy, setIsBusy] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);
  const actionInFlight = React.useRef(false);
  const providers = auth.isConfigured ? auth.availableProviders : [];

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
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        <VStack testID="auth-login-screen" className="gap-6 px-5 pb-10 pt-6">
          <VStack className="gap-3">
            <StatusPill label={t('auth.login.eyebrow')} />
            <Text className="text-3xl font-semibold leading-9 text-foreground">{t('auth.login.title')}</Text>
            <Text className="text-base leading-6 text-muted-foreground">{t('auth.login.subtitle')}</Text>
          </VStack>

          <VStack className="gap-2 rounded-3xl bg-primary/10 p-5">
            <Text className="text-base font-semibold text-foreground">{t('auth.login.guestBoundaryTitle')}</Text>
            <Text className="text-sm leading-5 text-muted-foreground">{t('auth.login.guestBoundaryBody')}</Text>
          </VStack>

          {providers.length > 0 ? (
            <VStack className="gap-4 rounded-3xl bg-card p-5">
              {providers.includes('google') ? (
                <ProviderControl provider="google" recent={auth.recentProvider === 'google'}>
                  <GoogleSigninButton
                    testID="auth-login-google"
                    accessibilityLabel={t('auth.login.googleAccessibilityLabel')}
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
                    accessibilityLabel={t('auth.login.appleAccessibilityLabel')}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isBusy }}
                    buttonStyle={AppleButton.Style.BLACK}
                    buttonType={AppleButton.Type.CONTINUE}
                    cornerRadius={12}
                    disabled={isBusy}
                    onPress={() => signIn('apple')}
                    pointerEvents={isBusy ? 'none' : 'auto'}
                    style={nativeProviderButtonStyle}
                  />
                </ProviderControl>
              ) : null}
            </VStack>
          ) : (
            <VStack className="gap-2 rounded-3xl bg-card p-5">
              <Text className="text-base font-semibold text-foreground">{t('auth.login.unavailableTitle')}</Text>
              <Text className="text-sm leading-5 text-muted-foreground">{t('auth.login.unavailableBody')}</Text>
            </VStack>
          )}

          {hasError ? (
            <Box className="rounded-2xl bg-destructive/10 px-4 py-3">
              <Text testID="auth-login-error" accessibilityRole="alert" className="text-sm leading-5 text-destructive">
                {t('auth.login.error')}
              </Text>
            </Box>
          ) : null}

          {onClose ? (
            <InstrumentButton
              testID="auth-login-close"
              accessibilityLabel={t('auth.login.close')}
              accessibilityRole="button"
              disabled={isBusy}
              label={t('auth.login.close')}
              onPress={onClose}
              variant="secondary"
            />
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
  const { t } = useTranslation();

  return (
    <VStack className="gap-2">
      {recent ? (
        <Text testID={`auth-login-recent-${provider}`} className="self-end text-xs font-semibold text-primary">
          {t('auth.login.recent')}
        </Text>
      ) : null}
      {children}
    </VStack>
  );
}
