import React from 'react';
import { useTranslation } from 'react-i18next';

import type { SocialProvider } from '../../auth/native-social-auth';
import { Box } from '../../components/ui/box';
import { Button, ButtonIcon } from '../../components/ui/button';
import { CloseIcon } from '../../components/ui/icon';
import { SafeAreaView } from '../../components/ui/safe-area-view';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { useAuth } from '../../states/auth';
import { SocialLoginButton } from './social-login-button';

type LoginScreenProps = {
  onClose?: () => void;
};

export default function LoginScreen({ onClose }: LoginScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const auth = useAuth();
  const [busyProvider, setBusyProvider] = React.useState<SocialProvider>();
  const [hasError, setHasError] = React.useState(false);
  const actionInFlight = React.useRef(false);
  const providers = auth.isConfigured ? auth.availableProviders : [];
  const orderedProviders = orderProviders(providers, auth.recentProvider);
  const isBusy = busyProvider !== undefined;

  const signIn = React.useCallback(
    async (provider: SocialProvider) => {
      if (actionInFlight.current) {
        return;
      }

      actionInFlight.current = true;
      setBusyProvider(provider);
      setHasError(false);

      try {
        await auth.signIn(provider);
      } catch {
        setHasError(true);
      } finally {
        actionInFlight.current = false;
        setBusyProvider(undefined);
      }
    },
    [auth],
  );

  return (
    <SafeAreaView testID="auth-login-safe-area" edges={['bottom']} className="bg-background">
      <VStack testID="auth-login-screen" space="lg" className="px-5 pb-5 pt-4">
        <Box className="relative min-h-11 justify-center">
          <Box
            testID="auth-login-brand-mark"
            accessible={false}
            className="mx-auto h-11 w-11 items-center justify-center rounded-xl bg-primary">
            <Text className="text-xl font-bold text-white">D</Text>
          </Box>
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

        <Text accessibilityRole="header" className="text-center text-2xl font-semibold leading-8 text-foreground">
          {t('auth.login.title')}
        </Text>

        {orderedProviders.length > 0 ? (
          <VStack space="sm">
            {orderedProviders.map(provider => {
              const isRecent = auth.recentProvider === provider;

              return (
                <SocialLoginButton
                  key={provider}
                  provider={provider}
                  label={provider === 'google' ? t('auth.login.google') : t('auth.login.apple')}
                  accessibilityLabel={getProviderAccessibilityLabel(
                    provider === 'google'
                      ? t('auth.login.googleAccessibilityLabel')
                      : t('auth.login.appleAccessibilityLabel'),
                    isRecent,
                    t('auth.login.recent'),
                  )}
                  busyLabel={t('auth.login.signingIn')}
                  recentLabel={isRecent ? t('auth.login.recentShort') : undefined}
                  busy={busyProvider === provider}
                  disabled={isBusy}
                  onPress={() => signIn(provider)}
                />
              );
            })}
          </VStack>
        ) : (
          <Box className="rounded-lg bg-muted px-4 py-4">
            <Text className="text-center text-base font-semibold text-foreground">{t('auth.login.unavailableTitle')}</Text>
          </Box>
        )}

        <Box testID="auth-login-status-row" className="min-h-11 justify-center">
          {hasError ? (
            <Text
              testID="auth-login-error"
              accessibilityRole="alert"
              className="text-center text-sm leading-5 text-destructive">
              {t('auth.login.error')}
            </Text>
          ) : null}
        </Box>
      </VStack>
    </SafeAreaView>
  );
}

function orderProviders(providers: SocialProvider[], recentProvider?: SocialProvider): SocialProvider[] {
  if (!recentProvider || !providers.includes(recentProvider)) {
    return [...providers];
  }

  return [recentProvider, ...providers.filter(provider => provider !== recentProvider)];
}

function getProviderAccessibilityLabel(baseLabel: string, recent: boolean, recentLabel: string): string {
  return recent ? `${baseLabel}, ${recentLabel}` : baseLabel;
}
