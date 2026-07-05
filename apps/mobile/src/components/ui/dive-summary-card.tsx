import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { tva } from '@gluestack-ui/utils/nativewind-utils';
import { HStack } from './hstack';
import { Text } from './text';
import { VStack } from './vstack';
import type { InstrumentTone } from './theme';

type DiveSummaryCardProps = {
  children?: React.ReactNode;
  accent?: InstrumentTone;
  variant?: 'card' | 'parchment' | 'dark';
  className?: string;
  style?: StyleProp<ViewStyle>;
};

type DiveSummaryCardHeaderProps = {
  title: string;
  eyebrow?: string;
  right?: React.ReactNode;
  titleTestID?: string;
};

type DiveSummaryCardMetricProps = {
  label: string;
  value: string;
  unit?: string;
};

const cardStyles = tva({
  base: 'relative overflow-hidden',
  variants: {
    variant: {
      card: 'rounded-2xl bg-card px-5 py-5',
      parchment: 'rounded-2xl bg-card px-5 py-5',
      dark: 'rounded-2xl bg-popover px-5 py-6',
    },
  },
  defaultVariants: {
    variant: 'card',
  },
});

function DiveSummaryCardRoot(props: DiveSummaryCardProps): React.JSX.Element {
  return (
    <VStack space="lg" className={cardStyles({ variant: props.variant, class: props.className })} style={props.style}>
      {props.children}
    </VStack>
  );
}

function DiveSummaryCardHeader(props: DiveSummaryCardHeaderProps): React.JSX.Element {
  return (
    <HStack className="items-center justify-between">
      <VStack space="xs" className="flex-1">
        {props.eyebrow ? (
          <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.eyebrow}</Text>
        ) : null}
        <Text testID={props.titleTestID} className="text-xl font-semibold leading-7 text-card-foreground">{props.title}</Text>
      </VStack>
      {props.right}
    </HStack>
  );
}

function DiveSummaryCardBody(props: {
  children?: React.ReactNode;
  onLayout?: React.ComponentProps<typeof VStack>['onLayout'];
  testID?: string;
}): React.JSX.Element {
  return <VStack testID={props.testID} onLayout={props.onLayout} space="md">{props.children}</VStack>;
}

function DiveSummaryCardMetric(props: DiveSummaryCardMetricProps): React.JSX.Element {
  return (
    <HStack className="min-h-12 items-center justify-between py-1.5">
      <Text className="flex-1 text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
      <HStack space="xs" className="items-baseline">
        <Text className="text-right text-xl font-semibold text-card-foreground">{props.value}</Text>
        {props.unit ? <Text className="text-sm font-semibold text-muted-foreground">{props.unit}</Text> : null}
      </HStack>
    </HStack>
  );
}

function DiveSummaryCardFooter(props: { children?: React.ReactNode }): React.JSX.Element {
  return <VStack className="pt-1">{props.children}</VStack>;
}

export const DiveSummaryCard = Object.assign(DiveSummaryCardRoot, {
  Header: DiveSummaryCardHeader,
  Body: DiveSummaryCardBody,
  Metric: DiveSummaryCardMetric,
  Footer: DiveSummaryCardFooter,
});
