import React from 'react';
import { AccessibilityInfo, Platform, type ScrollView as RNScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Box } from '../../../components/ui/box';
import { HStack } from '../../../components/ui/hstack';
import { ScreenBackButton } from '../../../components/ui/instrument';
import { ScrollView } from '../../../components/ui/scroll-view';
import { StickyActionBar } from '../../../components/ui/sticky-action-bar';
import { Text } from '../../../components/ui/text';
import { VStack } from '../../../components/ui/vstack';

/** Space left above an anchor after scrolling to it. */
const ANCHOR_TOP_GAP = 16;

type EditorAnchorRegistry = (name: string, y: number) => void;

const EditorAnchorContext = React.createContext<EditorAnchorRegistry | null>(null);

export type EditorScreenHandle = {
  /** Scrolls the named anchor to the top of the body. False when it has not been laid out yet. */
  scrollToAnchor: (name: string) => boolean;
};

type EditorScreenProps = {
  title: string;
  /** A short line above the title, such as where the record came from. */
  eyebrow?: string;
  titleTestID?: string;
  onBack: () => void;
  backTestID: string;
  /** The sticky bar content: one primary save button and at most one secondary button. */
  actions: React.ReactNode;
  /** A save failure shown right above the actions and announced to VoiceOver when it appears. */
  actionError?: string;
  actionErrorTestID?: string;
  /** `-body` is the scroll content and `-scroll-target` records the last anchor scroll for tests. */
  testID: string;
  /** Grouped sections. Wrap each one you may scroll to in an `EditorAnchor`. */
  children: React.ReactNode;
};

/**
 * The full-screen editor frame both editors share: a pinned header with back and title, a
 * scrolling body, and the save action pinned above the home indicator and the keyboard.
 */
export const EditorScreen = React.forwardRef<EditorScreenHandle, EditorScreenProps>(function EditorScreenWithRef(
  props,
  ref,
): React.JSX.Element {
  const { t } = useTranslation();
  const scrollRef = React.useRef<RNScrollView>(null);
  const bodyOffsetRef = React.useRef(0);
  const anchorOffsetsRef = React.useRef<Record<string, number>>({});
  const [lastScrollTarget, setLastScrollTarget] = React.useState<number>();
  const { actionError } = props;

  const registerAnchor = React.useCallback<EditorAnchorRegistry>((name, y) => {
    anchorOffsetsRef.current[name] = y;
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      scrollToAnchor: name => {
        const anchorOffset = anchorOffsetsRef.current[name];
        if (anchorOffset === undefined) {
          return false;
        }

        const target = Math.max(0, bodyOffsetRef.current + anchorOffset - ANCHOR_TOP_GAP);
        setLastScrollTarget(target);
        scrollRef.current?.scrollTo({ y: target, animated: true });
        return true;
      },
    }),
    [],
  );

  React.useEffect(() => {
    if (actionError) {
      AccessibilityInfo.announceForAccessibility(actionError);
    }
  }, [actionError]);

  return (
    <VStack testID={props.testID} className="flex-1 bg-background">
      <HStack space="md" className="items-center px-5 pb-2 pt-2">
        <ScreenBackButton
          testID={props.backTestID}
          accessibilityLabel={t('common.back')}
          onPress={props.onBack}
          className="self-center"
        />
        <VStack className="flex-1">
          {props.eyebrow ? (
            <Text className="text-xs font-semibold uppercase text-muted-foreground" numberOfLines={1}>
              {props.eyebrow}
            </Text>
          ) : null}
          <Text
            testID={props.titleTestID}
            accessibilityRole="header"
            className="text-xl font-semibold leading-7 text-foreground"
            numberOfLines={1}>
            {props.title}
          </Text>
        </VStack>
      </HStack>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="px-5 pt-4 pb-6"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
        <EditorAnchorContext.Provider value={registerAnchor}>
          <VStack
            testID={`${props.testID}-body`}
            space="xl"
            onLayout={event => {
              bodyOffsetRef.current = event.nativeEvent.layout.y;
            }}>
            {props.children}
          </VStack>
        </EditorAnchorContext.Provider>
        {lastScrollTarget === undefined ? null : (
          <Text testID={`${props.testID}-scroll-target`} className="hidden">{`${lastScrollTarget}`}</Text>
        )}
      </ScrollView>
      <StickyActionBar testID={`${props.testID}-actions`}>
        {actionError ? (
          <Text testID={props.actionErrorTestID} className="text-sm leading-5 text-destructive">
            {actionError}
          </Text>
        ) : null}
        {props.actions}
      </StickyActionBar>
    </VStack>
  );
});

/**
 * Marks a scroll target inside `EditorScreen`. Place it as a direct child of the editor body, so
 * its measured offset is relative to the body. The ID prop is not called `testID`, so a test lookup
 * by that ID lands on the view that has `onLayout`.
 */
export function EditorAnchor(props: { name: string; anchorTestID?: string; children: React.ReactNode }): React.JSX.Element {
  const registerAnchor = React.use(EditorAnchorContext);
  const { name } = props;

  return (
    <Box
      testID={props.anchorTestID}
      onLayout={event => {
        registerAnchor?.(name, event.nativeEvent.layout.y);
      }}>
      {props.children}
    </Box>
  );
}
