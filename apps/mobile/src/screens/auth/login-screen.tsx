import React from 'react';
import { useTranslation } from 'react-i18next';

import type { SocialProvider } from '../../auth/native-social-auth';
import { Box } from '../../components/ui/box';
import {
  Button,
  ButtonIcon,
  ButtonSpinner,
  ButtonText,
} from '../../components/ui/button';
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
  const [busyProvider, setBusyProvider] = React.useState<
    SocialProvider | 'development'
  >();
  const [hasError, setHasError] = React.useState(false);
  const actionInFlight = React.useRef(false);
  const providers = auth.isConfigured ? auth.availableProviders : [];
  const orderedProviders = orderProviders(providers, auth.recentProvider);
  const isBusy = busyProvider !== undefined;
  const hasLoginActions =
    orderedProviders.length > 0 || auth.isDevelopmentSignInAvailable;

  const signIn = React.useCallback(
    async (provider: SocialProvider | 'development') => {
      if (actionInFlight.current) {
        return;
      }

      actionInFlight.current = true;
      setBusyProvider(provider);
      setHasError(false);

      try {
        if (provider === 'development') {
          if (auth.signInForDevelopment === undefined) {
            throw new Error('Development sign-in unavailable');
          }

          await auth.signInForDevelopment();
        } else {
          await auth.signIn(provider);
        }
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
      <VStack testID="auth-login-screen" space="md" className="px-5 pb-2 pt-3">
        <Box className="relative min-h-11 justify-center">
          <Box
            testID="auth-login-brand-mark"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
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

        <Text
          accessibilityRole="header"
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.5}
          minimumFontScale={0.85}
          numberOfLines={2}
          className="text-center text-2xl font-semibold leading-8 text-foreground">
          {t('auth.login.title')}
        </Text>

        {hasLoginActions ? (
          <VStack space="sm">
            {auth.recentProvider && orderedProviders.includes(auth.recentProvider) ? (
              <Text
                testID="auth-login-recent-provider"
                maxFontSizeMultiplier={1.5}
                className="text-xs font-semibold text-muted-foreground">
                {t('auth.login.recent')}
              </Text>
            ) : null}
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
                  busy={busyProvider === provider}
                  disabled={isBusy}
                  onPress={() => signIn(provider)}
                />
              );
            })}
            {auth.isDevelopmentSignInAvailable ? (
              <Button
                testID="auth-login-development"
                accessibilityLabel={t('auth.login.development')}
                accessibilityRole="button"
                accessibilityState={{
                  busy: busyProvider === 'development',
                  disabled: isBusy,
                }}
                className="h-11 w-full"
                disabled={isBusy}
                onPress={() => signIn('development')}
                variant="outline">
                {busyProvider === 'development' ? (
                  <ButtonSpinner
                    testID="auth-login-spinner-development"
                    aria-label={t('auth.login.signingIn')}
                  />
                ) : null}
                <ButtonText>{t('auth.login.development')}</ButtonText>
              </Button>
            ) : null}
          </VStack>
        ) : (
          <Box className="rounded-lg bg-muted px-4 py-4">
            <Text className="text-center text-base font-semibold text-foreground">{t('auth.login.unavailableTitle')}</Text>
          </Box>
        )}

        {hasError ? (
          <Box testID="auth-login-status-row" className="justify-center py-1">
            <Text
              testID="auth-login-error"
              accessibilityRole="alert"
              maxFontSizeMultiplier={1.5}
              className="text-center text-sm leading-5 text-destructive">
              {t('auth.login.error')}
            </Text>
          </Box>
        ) : null}
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
