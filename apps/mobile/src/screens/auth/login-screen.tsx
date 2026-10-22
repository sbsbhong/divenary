import { AuthRepositoryError } from '@repo/supabase';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { useTranslation } from 'react-i18next';

import { NativeSocialAuthError, type SocialProvider } from '../../auth/native-social-auth';
import { BrandLogo } from '../../components/brand/brand-logo';
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
import { useLoadingFeedback } from '../../hooks/use-loading-feedback';
import { useAppPreferences } from '../../states/app-preferences';
import { useAuth } from '../../states/auth';
import { SocialLoginButton } from './social-login-button';

type LoginScreenProps = {
  onClose?: () => void;
};

/** What the user can do about a failed sign-in. The raw error never reaches the screen. */
type SignInErrorKind = 'offline' | 'provider' | 'server' | 'unknown';

const signInErrorKeys: Record<SignInErrorKind, string> = {
  offline: 'auth.login.errorOffline',
  provider: 'auth.login.errorProvider',
  server: 'auth.login.errorServer',
  unknown: 'auth.login.error',
};

export default function LoginScreen({ onClose }: LoginScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const auth = useAuth();
  const { resolvedTheme } = useAppPreferences();
  const [busyProvider, setBusyProvider] = React.useState<
    SocialProvider | 'development'
  >();
  const [errorKind, setErrorKind] = React.useState<SignInErrorKind>();
  const actionInFlight = React.useRef(false);
  const providers = auth.isConfigured ? auth.availableProviders : [];
  const orderedProviders = orderProviders(providers, auth.recentProvider);
  const isBusy = busyProvider !== undefined;
  const hasLoginActions =
    orderedProviders.length > 0 || auth.isDevelopmentSignInAvailable;
  const developmentFeedback = useLoadingFeedback(busyProvider === 'development');
  // The sheet stays locked while Auth exchanges the token, so a slow exchange gets a short line.
  const exchangeFeedback = useLoadingFeedback(auth.state.status === 'authenticating');
  const progressMessage = exchangeFeedback.isLongRunning
    ? t('auth.login.longRunning')
    : exchangeFeedback.showExtendedFeedback
      ? t('auth.login.checking')
      : undefined;
  const errorMessage = errorKind ? t(signInErrorKeys[errorKind]) : undefined;

  React.useEffect(() => {
    // iOS does not announce an alert-role Text by itself.
    if (errorMessage) {
      AccessibilityInfo.announceForAccessibility(errorMessage);
    }
  }, [errorMessage]);

  React.useEffect(() => {
    // The sheet is locked meanwhile, so VoiceOver has to hear why nothing is happening.
    if (progressMessage) {
      AccessibilityInfo.announceForAccessibility(progressMessage);
    }
  }, [progressMessage]);

  const signIn = React.useCallback(
    async (provider: SocialProvider | 'development') => {
      if (actionInFlight.current) {
        return;
      }

      actionInFlight.current = true;
      setBusyProvider(provider);
      setErrorKind(undefined);

      try {
        if (provider === 'development') {
          await auth.signInForDevelopment();
        } else {
          await auth.signIn(provider);
        }
      } catch (error) {
        setErrorKind(classifySignInError(error));
      } finally {
        actionInFlight.current = false;
        setBusyProvider(undefined);
      }
    },
    [auth],
  );

  return (
    <SafeAreaView testID="auth-login-safe-area" edges={['bottom']} className="flex-1 bg-background">
      <VStack testID="auth-login-screen" space="md" className="px-5 pb-2 pt-3">
        <Box className="relative min-h-11 justify-center">
          <BrandLogo
            testID="auth-login-brand-mark"
            className="mx-auto h-11 w-11 rounded-xl"
          />
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

        <VStack space="xs">
          <Text
            accessibilityRole="header"
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.5}
            minimumFontScale={0.85}
            numberOfLines={2}
            className="text-center text-2xl font-semibold leading-8 text-foreground">
            {t('auth.login.title')}
          </Text>
          <Text
            testID="auth-login-benefit"
            maxFontSizeMultiplier={1.5}
            className="text-center text-sm leading-5 text-muted-foreground">
            {t('auth.login.benefit')}
          </Text>
          <Text
            testID="auth-login-device-records"
            maxFontSizeMultiplier={1.5}
            className="text-center text-sm leading-5 text-muted-foreground">
            {t('auth.login.deviceRecordsKept')}
          </Text>
        </VStack>

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
                  theme={resolvedTheme}
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
                {developmentFeedback.showIndicator ? (
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
          <VStack testID="auth-login-unavailable" space="xs" className="rounded-2xl bg-card px-4 py-4">
            <Text className="text-center text-base font-semibold text-card-foreground">{t('auth.login.unavailableTitle')}</Text>
            <Text className="text-center text-sm leading-5 text-muted-foreground">
              {t('auth.login.unavailableDescription')}
            </Text>
          </VStack>
        )}

        {progressMessage ? (
          <Text
            testID="auth-login-progress"
            maxFontSizeMultiplier={1.5}
            className="text-center text-sm leading-5 text-muted-foreground">
            {progressMessage}
          </Text>
        ) : null}

        {errorMessage ? (
          <Box testID="auth-login-status-row" className="justify-center py-1">
            <Text
              testID="auth-login-error"
              accessibilityRole="alert"
              maxFontSizeMultiplier={1.5}
              className="text-center text-sm leading-5 text-destructive">
              {errorMessage}
            </Text>
          </Box>
        ) : null}
      </VStack>
    </SafeAreaView>
  );
}

function classifySignInError(error: unknown): SignInErrorKind {
  if (error instanceof AuthRepositoryError) {
    return error.kind === 'network' ? 'offline' : 'server';
  }

  // The provider sheet failed or returned no usable credential; another provider may still work.
  if (error instanceof NativeSocialAuthError) {
    return 'provider';
  }

  return 'unknown';
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
