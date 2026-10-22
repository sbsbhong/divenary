import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from './box';
import { HStack } from './hstack';
import { ScreenBackButton } from './instrument';
import { SkeletonBlock, useContentLoading } from './skeleton-block';
import { VStack } from './vstack';

type DetailSkeletonProps = {
  /** The real back control stays usable while the content loads. */
  onBack?: () => void;
  /** A new scope (for example another item id) restarts the delay. */
  scope?: string;
  testID?: string;
};

// Each line sits in a sized Box and fills it: SkeletonBlock's own `w-full` class would win over a
// width class passed to it.
const SUMMARY_FACT_WIDTHS = ['w-1/2', 'w-2/3', 'w-2/5'] as const;
const ROW_WIDTHS = [
  { label: 'w-1/3', value: 'w-1/5' },
  { label: 'w-2/5', value: 'w-1/6' },
  { label: 'w-1/4', value: 'w-1/4' },
] as const;

/**
 * Stands in for a grouped detail screen whose item is not loaded yet: a large title line, a
 * summary group with three facts and one group of three label/value rows. Nothing is visible for
 * the first second; the groups take their card surface only when the lines appear.
 */
export function DetailSkeleton({ onBack, scope, testID = 'detail-skeleton' }: DetailSkeletonProps): React.JSX.Element {
  const { t } = useTranslation();
  const visible = useContentLoading(true, scope);
  const groupSurface = visible ? 'rounded-2xl bg-card' : 'rounded-2xl';

  return (
    <VStack testID={testID} space="lg" accessibilityState={{ busy: true }}>
      {onBack ? (
        <ScreenBackButton testID={`${testID}-back`} accessibilityLabel={t('common.back')} onPress={onBack} />
      ) : null}
      <VStack
        space="lg"
        accessible={visible}
        accessibilityLabel={visible ? t('feedback.loadingDetail') : undefined}>
        {/* Large title: text-3xl with leading-9 in a min-h-11 header. */}
        <Box className="min-h-11 w-3/5 justify-center">
          <SkeletonBlock testID={`${testID}-title`} visible={visible} className="h-7" />
        </Box>
        <HStack space="md" className={`${groupSurface} px-4 py-4`}>
          {SUMMARY_FACT_WIDTHS.map((width, index) => (
            <VStack key={index} space="xs" className="flex-1">
              <Box className="w-3/5">
                <SkeletonBlock visible={visible} />
              </Box>
              <Box className={width}>
                <SkeletonBlock visible={visible} className="h-7" />
              </Box>
            </VStack>
          ))}
        </HStack>
        <VStack className={`overflow-hidden ${groupSurface}`}>
          {ROW_WIDTHS.map((row, index) => (
            <VStack key={index}>
              {index > 0 ? <Box className="ml-4 h-px bg-background" /> : null}
              <HStack className="min-h-12 items-center justify-between px-4 py-3">
                <Box className={row.label}>
                  <SkeletonBlock visible={visible} />
                </Box>
                <Box className={row.value}>
                  <SkeletonBlock visible={visible} />
                </Box>
              </HStack>
            </VStack>
          ))}
        </VStack>
      </VStack>
    </VStack>
  );
}
