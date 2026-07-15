import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GluestackUIProvider } from './components/ui/gluestack-ui-provider';
import { AppPreferencesProvider, useAppPreferences } from './states/app-preferences';
import { AuthProvider } from './states/auth';

type ProvidersProps = {
  children?: React.ReactNode;
};

export default function Providers(props: ProvidersProps): React.JSX.Element {
  const [queryClient] = React.useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AppPreferencesProvider>
          <AuthProvider>
            <ThemedProviders>{props.children}</ThemedProviders>
          </AuthProvider>
        </AppPreferencesProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function ThemedProviders(props: ProvidersProps): React.JSX.Element {
  const { resolvedTheme } = useAppPreferences();

  return (
    <GluestackUIProvider mode={resolvedTheme}>
      <StatusBar barStyle={resolvedTheme === 'dark' ? 'light-content' : 'dark-content'} />
      {props.children}
    </GluestackUIProvider>
  );
}
