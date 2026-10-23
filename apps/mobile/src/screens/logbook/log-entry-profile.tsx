import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useGluestackColors } from '../../components/ui/gluestack-ui-provider';
import { HStack } from '../../components/ui/hstack';
import { SkeletonBlock, useContentLoading } from '../../components/ui/skeleton-block';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { ProfileRevealChart } from '../../components/charts/profile-reveal-chart';
import { MOTION_TIMING } from '../../constants/motion';
import type { WatchDepthSample } from '../../types/dive-session';
import { buildProfileRenderModel } from '../../utils/session-profile-chart';
import { formatLogDepth, formatLogTemperature } from './log-formatters';

const CHART_WIDTH = 320;
const DEPTH_CHART_HEIGHT = 64;
const TEMPERATURE_CHART_HEIGHT = 40;

/**
 * A quiet profile line drawn straight on the group surface, without a box of its own. Depth uses
 * the accent; temperature is lower and thinner in the warm tone so it reads as secondary.
 * VoiceOver reads the title and the range.
 *
 * The first time an entry's chart is shown in this runtime it draws from left to right, and the
 * depth chart's logo rides the line. `animationKey` names that first show: the entry's localId for
 * depth, and a suffixed key for temperature. Showing the same key again starts at the end state.
 */
export function LogEntryProfile(props: {
  samples: WatchDepthSample[];
  kind: 'depth' | 'temperature';
  title: string;
  testID: string;
  animationKey: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const palette = useGluestackColors();
  const isDepth = props.kind === 'depth';
  const height = isDepth ? DEPTH_CHART_HEIGHT : TEMPERATURE_CHART_HEIGHT;
  const chart = useMemo(
    () => buildProfileRenderModel({ samples: props.samples, kind: props.kind, width: CHART_WIDTH, height }),
    [props.samples, props.kind, height],
  );

  if (!chart.isAvailable || !chart.path) {
    return null;
  }

  const lineColor = isDepth ? palette.primary : palette.mutedForeground;
  const summary = isDepth
    ? t('sessionProfile.depthSummary', { max: formatLogDepth(chart.maxValue) })
    : t('sessionProfile.temperatureSummary', {
        min: formatLogTemperature(chart.minValue),
        max: formatLogTemperature(chart.maxValue),
      });

  return (
    <VStack testID={props.testID} space="xs" accessible accessibilityRole="image" accessibilityLabel={`${props.title}. ${summary}`}>
      <HStack className="items-baseline justify-between">
        <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.title}</Text>
        {isDepth ? null : (
          <Text className="text-xs text-muted-foreground">
            {formatLogTemperature(chart.minValue)} – {formatLogTemperature(chart.maxValue)}
          </Text>
        )}
      </HStack>
      <ProfileRevealChart
        key={props.animationKey}
        testID={`${props.testID}-chart`}
        chart={chart}
        width={CHART_WIDTH}
        height={height}
        animationKey={props.animationKey}
        drawDuration={MOTION_TIMING.chartDraw}
        drawDelay={MOTION_TIMING.chartAfterPush + (isDepth ? 0 : MOTION_TIMING.chartSecondaryDelay)}
        lineColor={lineColor}
        lineOpacity={isDepth ? 1 : 0.7}
        lineWidth={isDepth ? 2.5 : 1.5}
        areaColor={isDepth ? lineColor : undefined}
        logoColor={isDepth ? lineColor : undefined}
      />
    </VStack>
  );
}

/**
 * Holds the depth profile's place while the full watch profile is read. Nothing shows for the
 * first second; the slot already has the chart's size, so the line replaces it without a jump.
 */
export function LogEntryProfileSkeleton(props: { scope: string; title: string }): React.JSX.Element {
  const { t } = useTranslation();
  const visible = useContentLoading(true, props.scope);

  return (
    <VStack
      testID="log-entry-detail-profile-loading"
      space="xs"
      accessible={visible}
      accessibilityLabel={visible ? t('logbook.profileLoading') : undefined}
      accessibilityState={{ busy: true }}>
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.title}</Text>
      <SkeletonBlock visible={visible} className="h-16 rounded-lg" />
    </VStack>
  );
}
