import React from 'react';
import { DiveSummaryCard } from './dive-summary-card';
import { InstrumentButton } from './instrument';
import { Text } from './text';
import { VStack } from './vstack';

type ListStateCardProps = {
  testID: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The action is running (a retry, say): busy at once, spinner after the shared delay. */
  actionPending?: boolean;
};

/** One card for empty, filtered-out, and failed list states so each reads differently. */
export function ListStateCard(props: ListStateCardProps): React.JSX.Element {
  return (
    <DiveSummaryCard>
      <VStack testID={props.testID} space="md">
        <DiveSummaryCard.Header title={props.title} />
        {props.message ? <Text className="text-sm leading-5 text-muted-foreground">{props.message}</Text> : null}
        {props.actionLabel && props.onAction ? (
          <InstrumentButton
            testID={`${props.testID}-action`}
            label={props.actionLabel}
            onPress={props.onAction}
            pending={props.actionPending}
          />
        ) : null}
      </VStack>
    </DiveSummaryCard>
  );
}
