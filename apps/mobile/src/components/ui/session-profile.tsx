import React from 'react';
import { Defs, LinearGradient, Path, Stop, Svg } from 'react-native-svg';
import type { WatchDepthSample } from '../../types/dive-session';
import { buildProfileRenderModel } from '../../utils/session-profile-chart';
import { Text } from './text';
import { VStack } from './vstack';

type SessionProfileProps = {
  samples: WatchDepthSample[];
  title: string;
  kind: 'depth' | 'temperature';
  testID?: string;
};

function SessionProfileRoot(props: SessionProfileProps): React.JSX.Element {
  const chart = buildProfileRenderModel({
    samples: props.samples,
    kind: props.kind,
  });
  const gradientId = `${props.kind}-profile-fill`;
  const strokeColor = props.kind === 'depth' ? '#0ea5e9' : '#14b8a6';
  const fillColor = props.kind === 'depth' ? '#0ea5e9' : '#14b8a6';

  return (
    <VStack testID={props.testID} space="md" className="rounded-2xl bg-muted px-4 py-4">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.title}</Text>
      <VStack className="h-24 overflow-hidden rounded-lg bg-background/70">
        {chart.isAvailable ? (
          <Svg testID={props.testID ? `${props.testID}-chart` : undefined} width="100%" height="100%" viewBox="0 0 320 96">
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={fillColor} stopOpacity="0.24" />
                <Stop offset="1" stopColor={fillColor} stopOpacity="0.04" />
              </LinearGradient>
            </Defs>
            {chart.areaPath ? <Path d={chart.areaPath} fill={`url(#${gradientId})`} /> : null}
            {chart.path ? <Path d={chart.path} fill="none" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}
          </Svg>
        ) : (
          <VStack className="h-full items-center justify-center px-3">
            <Text className="text-xs font-semibold text-muted-foreground">No samples</Text>
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
