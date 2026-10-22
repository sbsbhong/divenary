import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GluestackUIProvider } from './components/ui/gluestack-ui-provider';
import { AppPreferencesProvider, useAppPreferences } from './states/app-preferences';
import { AuthProvider } from './states/auth';
import { AccountDataProvider } from './states/account-data';
import { AppErrorBoundary } from './components/app-error-boundary';
import { AppFeedbackProvider } from './components/feedback/app-feedback';
import { SignInFeedback } from './components/feedback/sign-in-feedback';

type ProvidersProps = {
  children?: React.ReactNode;
};

export default function Providers(props: ProvidersProps): React.JSX.Element {
  const [queryClient] = React.useState(
    // One retry: a second failure shows the error state with a retry action instead of a long wait.
    () => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
  );

  React.useEffect(() => {
    return () => {
      // Child observers schedule GC while unmounting, so clear after their cleanup completes.
      queueMicrotask(() => {
        queryClient.clear();
      });
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AppPreferencesProvider>
          <ThemedProviders>
            <AppErrorBoundary>
              <AuthProvider>
                {/* Above the account-data gate: a data-owner switch replaces everything below it. */}
                <AppFeedbackProvider>
                  <SignInFeedback />
                  <AccountDataProvider queryClient={queryClient}>{props.children}</AccountDataProvider>
                </AppFeedbackProvider>
              </AuthProvider>
            </AppErrorBoundary>
          </ThemedProviders>
        </AppPreferencesProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function ThemedProviders(props: ProvidersProps): React.JSX.Element {
  const { resolvedTheme, themePreference } = useAppPreferences();

  return (
    <GluestackUIProvider mode={themePreference}>
      <StatusBar barStyle={resolvedTheme === 'dark' ? 'light-content' : 'dark-content'} />
      {props.children}
    </GluestackUIProvider>
  );
}
