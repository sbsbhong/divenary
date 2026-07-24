import React from 'react';
import { HStack } from './hstack';
import { Icon, PhoneIcon } from './icon';
import { Text } from './text';

type ListStatusBadgeProps = {
  kind: 'demo' | 'device';
  label: string;
  testID?: string;
};

export function ListStatusBadge(props: ListStatusBadgeProps): React.JSX.Element {
  const isDevice = props.kind === 'device';

  return (
    <HStack
      testID={props.testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={
        isDevice
          ? 'self-start items-center rounded-full bg-warning/10 px-2.5 py-1'
          : 'self-start items-center rounded-full bg-muted px-2.5 py-1'
      }>
      {isDevice ? <Icon as={PhoneIcon} size="xs" className="mr-1 text-warning" /> : null}
      <Text size="xs" className={isDevice ? 'font-semibold text-warning' : 'font-semibold text-muted-foreground'}>
        {props.label}
      </Text>
    </HStack>
  );
}
