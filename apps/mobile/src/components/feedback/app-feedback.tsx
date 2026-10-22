import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box } from '../ui/box';
import { HStack } from '../ui/hstack';
import { AlertCircleIcon, CheckCircleIcon, Icon } from '../ui/icon';
import { Pressable } from '../ui/pressable';
import { Text } from '../ui/text';

export type AppFeedbackTone = 'success' | 'attention';

type AppFeedbackMessage = {
  id: number;
  message: string;
  tone: AppFeedbackTone;
};

type AppFeedbackContextValue = {
  /** Reports a finished action once. A newer message replaces the one on screen. */
  notify: (message: string, tone?: AppFeedbackTone) => void;
};

type AppFeedbackInsetContextValue = (offset: number) => void;

export const APP_FEEDBACK_DISMISS_MS = 4_000;
const APP_FEEDBACK_EDGE_GAP = 16;

const AppFeedbackContext = React.createContext<AppFeedbackContextValue | undefined>(undefined);
const AppFeedbackInsetContext = React.createContext<AppFeedbackInsetContextValue | undefined>(undefined);
const NOOP_FEEDBACK: AppFeedbackContextValue = { notify: () => undefined };

type AppFeedbackProviderProps = {
  children: React.ReactNode;
};

export function AppFeedbackProvider(props: AppFeedbackProviderProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const nextId = React.useRef(0);
  const [current, setCurrent] = React.useState<AppFeedbackMessage | undefined>();
  const [bottomOffset, setBottomOffset] = React.useState(0);

  const notify = React.useCallback((message: string, tone: AppFeedbackTone = 'success') => {
    nextId.current += 1;
    setCurrent({ id: nextId.current, message, tone });
    // iOS has no polite live region, so announce the message once.
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  React.useEffect(() => {
    if (!current) {
      return;
    }
    const timer = setTimeout(() => {
      setCurrent(visible => (visible?.id === current.id ? undefined : visible));
    }, APP_FEEDBACK_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [current]);

  const value = React.useMemo(() => ({ notify }), [notify]);

  return (
    <AppFeedbackContext.Provider value={value}>
      <AppFeedbackInsetContext.Provider value={setBottomOffset}>{props.children}</AppFeedbackInsetContext.Provider>
      {current ? (
        <Box
          pointerEvents="box-none"
          className="absolute left-4 right-4"
          style={{ bottom: insets.bottom + APP_FEEDBACK_EDGE_GAP + bottomOffset }}>
          <Pressable
            testID="app-feedback"
            accessibilityRole={current.tone === 'attention' ? 'alert' : 'text'}
            accessibilityLabel={current.message}
            onPress={() => setCurrent(undefined)}
            className="rounded-2xl bg-foreground px-4 py-3">
            <HStack space="sm" className="items-center">
              <Icon
                as={current.tone === 'attention' ? AlertCircleIcon : CheckCircleIcon}
                className="text-background"
              />
              <Text testID="app-feedback-message" className="flex-1 text-sm font-semibold text-background">
                {current.message}
              </Text>
            </HStack>
          </Pressable>
        </Box>
      ) : null}
    </AppFeedbackContext.Provider>
  );
}

/**
 * Keeps messages above chrome that the host cannot see, such as the tab bar. The host sits above
 * the account-data gate so a message survives a data-owner switch (sign-in, sign-out).
 */
export function useAppFeedbackBottomInset(offset: number): void {
  const setOffset = React.useContext(AppFeedbackInsetContext);
  React.useEffect(() => {
    setOffset?.(offset);
    // The chrome goes away with its owner (for example the start shell replaces the tab bar).
    return () => setOffset?.(0);
  }, [offset, setOffset]);
}

/** Screens outside the provider (tests, previews) get a silent no-op. */
export function useAppFeedback(): AppFeedbackContextValue {
  return React.useContext(AppFeedbackContext) ?? NOOP_FEEDBACK;
}
