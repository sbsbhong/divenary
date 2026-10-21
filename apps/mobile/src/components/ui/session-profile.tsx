import React from 'react';
import { useTranslation } from 'react-i18next';
import { Defs, LinearGradient, Path, Stop, Svg } from 'react-native-svg';
import type { WatchDepthSample } from '../../types/dive-session';
import { formatDepth, formatTemperature } from '../../utils/dive-formatters';
import { buildProfileRenderModel } from '../../utils/session-profile-chart';
import { useGluestackColors } from './gluestack-ui-provider';
import { HStack } from './hstack';
import { Text } from './text';
import { VStack } from './vstack';

type SessionProfileProps = {
  samples: WatchDepthSample[];
  title: string;
  kind: 'depth' | 'temperature';
  testID?: string;
};

function SessionProfileRoot(props: SessionProfileProps): React.JSX.Element {
  const { t } = useTranslation();
  const palette = useGluestackColors();
  const chart = buildProfileRenderModel({
    samples: props.samples,
    kind: props.kind,
  });
  const gradientId = `${props.kind}-profile-fill`;
  // Depth follows the app accent; temperature uses the theme's warm orange so the two lines differ.
  const lineColor = props.kind === 'depth' ? palette.primary : palette.warning;
  const summary = !chart.isAvailable
    ? t('sessionProfile.noSamples')
    : props.kind === 'depth'
      ? t('sessionProfile.depthSummary', { max: formatDepth(chart.maxValue), count: chart.rawSampleCount })
      : t('sessionProfile.temperatureSummary', {
          min: formatTemperature(chart.minValue),
          max: formatTemperature(chart.maxValue),
          count: chart.rawSampleCount,
        });

  return (
    <VStack
      testID={props.testID}
      space="md"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${props.title}. ${summary}`}
      className="rounded-2xl bg-muted px-4 py-4">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.title}</Text>
      <VStack className="h-24 overflow-hidden rounded-lg bg-background/70">
        {chart.isAvailable ? (
          <Svg testID={props.testID ? `${props.testID}-chart` : undefined} width="100%" height="100%" viewBox="0 0 320 96">
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={lineColor} stopOpacity="0.24" />
                <Stop offset="1" stopColor={lineColor} stopOpacity="0.04" />
              </LinearGradient>
            </Defs>
            {chart.areaPath ? <Path d={chart.areaPath} fill={`url(#${gradientId})`} /> : null}
            {chart.path ? <Path d={chart.path} fill="none" stroke={lineColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}
          </Svg>
        ) : (
          <VStack className="h-full items-center justify-center px-3">
            <Text className="text-xs font-semibold text-muted-foreground">{t('sessionProfile.noSamples')}</Text>
          </VStack>
        )}
      </VStack>
    </VStack>
  );
}

function SessionProfileLegend(props: { label: string; value: string }): React.JSX.Element {
  return (
    <HStack className="justify-between">
      <Text className="text-sm font-semibold text-muted-foreground">{props.label}</Text>
      <Text className="text-sm font-semibold text-foreground">{props.value}</Text>
    </HStack>
  );
}

export const SessionProfile = Object.assign(SessionProfileRoot, {
  Legend: SessionProfileLegend,
});
