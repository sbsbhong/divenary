import React from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Section } from '../../../components/ui/grouped-list';
import { HStack } from '../../../components/ui/hstack';
import { ChevronDownIcon, ChevronUpIcon, Icon } from '../../../components/ui/icon';
import { Pressable } from '../../../components/ui/pressable';
import { Text } from '../../../components/ui/text';
import { VStack } from '../../../components/ui/vstack';
import { rowAccessibilityLabel } from './field-row';

type CollapsibleSectionProps = {
  /** The toggle row's label, for example "세부 정보". */
  title: string;
  /** One short line naming what is inside, shown while collapsed. */
  summary?: string;
  /** Opens the section on the first render, for a draft that already has values inside. */
  hasValues: boolean;
  /** Opens the section when this turns true, for example after an invalid field inside it. It never closes it. */
  forceOpen?: boolean;
  /** Controls the open state from outside; leave it out to let the toggle own it. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Wrapper; `-toggle` is the row button and `-content` holds the children while open. */
  testID: string;
  /** Grouped `Section`s, or anything else that should appear only while open. */
  children: React.ReactNode;
};

/**
 * Progressive disclosure for optional editor fields: one toggle row in its own group, and the
 * sections below it only while open. Closing keeps the form values; the fields just unmount.
 */
export function CollapsibleSection(props: CollapsibleSectionProps): React.JSX.Element {
  const [ownExpanded, setOwnExpanded] = React.useState(props.hasValues);
  const expanded = props.expanded ?? ownExpanded;
  const { forceOpen } = props;
  // The latest callback, so the force-open effect runs only when `forceOpen` itself changes.
  const onExpandedChangeRef = React.useRef(props.onExpandedChange);
  onExpandedChangeRef.current = props.onExpandedChange;

  const setExpanded = React.useCallback((nextExpanded: boolean) => {
    setOwnExpanded(nextExpanded);
    onExpandedChangeRef.current?.(nextExpanded);
  }, []);

  React.useEffect(() => {
    if (forceOpen) {
      setExpanded(true);
    }
  }, [forceOpen, setExpanded]);

  return (
    <VStack testID={props.testID} space="lg" onLayout={props.onLayout}>
      <Section>
        <Pressable
          testID={`${props.testID}-toggle`}
          accessibilityRole="button"
          accessibilityLabel={rowAccessibilityLabel([props.title, !expanded && props.summary])}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          className="active:bg-muted">
          <HStack space="md" className="min-h-12 items-center px-4 py-3">
            <VStack className="flex-1">
              <Text className="text-base font-semibold text-card-foreground">{props.title}</Text>
              {!expanded && props.summary ? (
                // Korean wraps between words here, so a two-line summary never splits a word like 태그.
                <Text className="text-sm leading-5 text-muted-foreground" numberOfLines={2} lineBreakStrategyIOS="hangul-word">
                  {props.summary}
                </Text>
              ) : null}
            </VStack>
            <Icon as={expanded ? ChevronUpIcon : ChevronDownIcon} className="text-muted-foreground" />
          </HStack>
        </Pressable>
      </Section>
      {expanded ? (
        <VStack testID={`${props.testID}-content`} space="lg">
          {props.children}
        </VStack>
      ) : null}
    </VStack>
  );
}
