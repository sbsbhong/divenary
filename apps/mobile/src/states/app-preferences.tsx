import React from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';
import i18n, { resolveSupportedLanguage, type SupportedLanguage } from '../i18n';
import {
  defaultAppPreferencesStorage,
  type AppPreferencesStorage,
} from './app-preferences-storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export type AppPreferences = {
  isHydrated: boolean;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  language: SupportedLanguage;
  watchSyncNotificationsEnabled: boolean;
  setThemePreference: (themePreference: ThemePreference) => void;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  setWatchSyncNotificationsEnabled: (enabled: boolean) => Promise<void>;
};

type AppPreferencesProviderProps = {
  children?: React.ReactNode;
  storage?: AppPreferencesStorage;
};

const AppPreferencesContext = React.createContext<AppPreferences | undefined>(undefined);

export const resolveThemePreference = (
  themePreference: ThemePreference,
  deviceColorScheme: ColorSchemeName | null | undefined,
): ResolvedTheme => {
  if (themePreference === 'system') {
    return deviceColorScheme === 'dark' ? 'dark' : 'light';
  }

  return themePreference;
};

const resolveInitialLanguage = (): SupportedLanguage =>
  resolveSupportedLanguage(i18n.resolvedLanguage ?? i18n.language);

export function AppPreferencesProvider(props: AppPreferencesProviderProps): React.JSX.Element {
  const deviceColorScheme = useColorScheme();
  const storage = props.storage ?? defaultAppPreferencesStorage;
  const [themePreference, setThemePreferenceState] = React.useState<ThemePreference>('system');
  const [language, setLanguageState] = React.useState<SupportedLanguage>(resolveInitialLanguage);
  const [watchSyncNotificationsEnabled, setWatchSyncNotificationsEnabledState] = React.useState(false);
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    let isMounted = true;

    storage
      .load()
      .then(async storedPreferences => {
        if (!isMounted) {
          return;
        }

        setThemePreferenceState(storedPreferences.themePreference);
        setWatchSyncNotificationsEnabledState(storedPreferences.watchSyncNotificationsEnabled);
        await i18n.changeLanguage(storedPreferences.language);

        if (isMounted) {
          setLanguageState(storedPreferences.language);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setIsHydrated(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [storage]);

  React.useEffect(() => {
    const handleLanguageChanged = (nextLanguage: string) => {
      setLanguageState(resolveSupportedLanguage(nextLanguage));
    };

    i18n.on('languageChanged', handleLanguageChanged);

    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, []);

  const setThemePreference = React.useCallback(
    (nextThemePreference: ThemePreference) => {
      setThemePreferenceState(nextThemePreference);
      void storage.save({
        themePreference: nextThemePreference,
        language,
        watchSyncNotificationsEnabled,
      });
    },
    [language, storage, watchSyncNotificationsEnabled],
  );

  const setLanguage = React.useCallback(
    async (nextLanguage: SupportedLanguage) => {
      const supportedLanguage = resolveSupportedLanguage(nextLanguage);

      try {
        await i18n.changeLanguage(supportedLanguage);
        setLanguageState(supportedLanguage);
        await storage.save({
          themePreference,
          language: supportedLanguage,
          watchSyncNotificationsEnabled,
        });
      } catch {
        // Keep the previous language selection when i18next rejects the change.
      }
    },
    [storage, themePreference, watchSyncNotificationsEnabled],
  );

  const setWatchSyncNotificationsEnabled = React.useCallback(
    async (enabled: boolean) => {
      setWatchSyncNotificationsEnabledState(enabled);
      await storage.save({
        themePreference,
        language,
        watchSyncNotificationsEnabled: enabled,
      });
    },
    [language, storage, themePreference],
  );

  const resolvedTheme = React.useMemo(
    () => resolveThemePreference(themePreference, deviceColorScheme),
    [deviceColorScheme, themePreference],
  );

  const value = React.useMemo<AppPreferences>(
    () => ({
      isHydrated,
      themePreference,
      resolvedTheme,
      language,
      watchSyncNotificationsEnabled,
      setThemePreference,
      setLanguage,
      setWatchSyncNotificationsEnabled,
    }),
    [
      isHydrated,
      language,
      resolvedTheme,
      setLanguage,
      setThemePreference,
      setWatchSyncNotificationsEnabled,
      themePreference,
      watchSyncNotificationsEnabled,
    ],
  );

  return <AppPreferencesContext.Provider value={value}>{props.children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences(): AppPreferences {
  const preferences = React.useContext(AppPreferencesContext);

  if (!preferences) {
    throw new Error('useAppPreferences must be used within AppPreferencesProvider');
  }

  return preferences;
}
