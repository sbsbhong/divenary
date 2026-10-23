import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MOTION_TIMING } from '../../constants/motion';
import { useLeavingValue } from '../../hooks/use-leaving-value';
import { Box } from '../ui/box';
import { HStack } from '../ui/hstack';
import { AlertCircleIcon, CheckCircleIcon, Icon } from '../ui/icon';
import { Pressable } from '../ui/pressable';
import { Text } from '../ui/text';
import { FeedbackLayer } from './feedback-layer';

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
  // The message being replaced or closed keeps fading for the dismiss time, without taking touches.
  const leaving = useLeavingValue(current, MOTION_TIMING.dismiss);

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
      {leaving ? (
        <FeedbackLayer
          key={leaving.id}
          leaving
          className="absolute left-4 right-4"
          style={{ bottom: insets.bottom + APP_FEEDBACK_EDGE_GAP + bottomOffset }}>
          <AppFeedbackCard message={leaving} inert />
        </FeedbackLayer>
      ) : null}
      {current ? (
        <FeedbackLayer
          key={current.id}
          className="absolute left-4 right-4"
          style={{ bottom: insets.bottom + APP_FEEDBACK_EDGE_GAP + bottomOffset }}>
          <AppFeedbackCard message={current} onDismiss={() => setCurrent(undefined)} />
        </FeedbackLayer>
      ) : null}
    </AppFeedbackContext.Provider>
  );
}

/**
 * The message card. A leaving copy is inert: no press and no test IDs, so the message that is going
 * away cannot be found or tapped while it fades.
 */
function AppFeedbackCard(props: {
  message: AppFeedbackMessage;
  inert?: boolean;
  onDismiss?: () => void;
}): React.JSX.Element {
  const { message, inert = false, onDismiss } = props;
  const content = (
    <HStack space="sm" className="items-center">
      <Icon as={message.tone === 'attention' ? AlertCircleIcon : CheckCircleIcon} className="text-background" />
      <Text testID={inert ? undefined : 'app-feedback-message'} className="flex-1 text-sm font-semibold text-background">
        {message.message}
      </Text>
    </HStack>
  );

  if (inert) {
    return <Box className="rounded-2xl bg-foreground px-4 py-3">{content}</Box>;
  }

  return (
    <Pressable
      testID="app-feedback"
      accessibilityRole={message.tone === 'attention' ? 'alert' : 'text'}
      accessibilityLabel={message.message}
      onPress={onDismiss}
      className="rounded-2xl bg-foreground px-4 py-3">
      {content}
    </Pressable>
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
