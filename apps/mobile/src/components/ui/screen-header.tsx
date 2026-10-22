import React from 'react';
import { HStack } from './hstack';
import { Text } from './text';

type ScreenHeaderProps = {
  title: string;
  /** Up to two compact actions on the right; the screen's one primary action lives elsewhere. */
  trailing?: React.ReactNode;
  titleTestID?: string;
};

/** The large screen title every tab and detail screen starts with. */
export function ScreenHeader(props: ScreenHeaderProps): React.JSX.Element {
  return (
    <HStack space="md" className="min-h-11 items-center justify-between">
      <Text
        testID={props.titleTestID}
        accessibilityRole="header"
        className="flex-1 text-3xl font-semibold leading-9 text-foreground"
        numberOfLines={2}>
        {props.title}
      </Text>
      {props.trailing ? <HStack space="sm" className="shrink-0 items-center">{props.trailing}</HStack> : null}
    </HStack>
  );
}
