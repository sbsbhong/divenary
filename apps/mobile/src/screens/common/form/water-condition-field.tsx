import React from 'react';
import { useTranslation } from 'react-i18next';
import { HStack } from '../../../components/ui/hstack';
import { SelectorPill } from '../../../components/ui/instrument';
import { VStack } from '../../../components/ui/vstack';
import type { WatchSession } from '../../../types/dive-session';

export type WaterCondition = NonNullable<WatchSession['waterCondition']>;

// "Unknown" is what no selection already means, so it is not offered as a choice.
const WATER_CONDITION_ROWS: WaterCondition[][] = [
  ['calm', 'mild', 'choppy'],
  ['surge', 'current'],
];

type WaterConditionControlProps = {
  value?: WaterCondition;
  onChange: (value: WaterCondition | undefined) => void;
  /** Each choice gets `<prefix>-<condition>`. */
  testIDPrefix: string;
};

/**
 * The water-condition choice the log and plan editors share: two segmented rows. Tapping the
 * selected condition clears it. A stored `unknown` matches no choice, so it reads as not set.
 */
export function WaterConditionControl(props: WaterConditionControlProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <VStack space="xs">
      {WATER_CONDITION_ROWS.map(row => (
        <HStack key={row.join('-')} space="xs" className="rounded-full bg-muted p-1">
          {row.map(condition => (
            <SelectorPill
              key={condition}
              testID={`${props.testIDPrefix}-${condition}`}
              className="flex-1"
              label={t(`waterConditions.${condition}`)}
              selected={props.value === condition}
              onPress={() => props.onChange(props.value === condition ? undefined : condition)}
            />
          ))}
        </HStack>
      ))}
    </VStack>
  );
}
