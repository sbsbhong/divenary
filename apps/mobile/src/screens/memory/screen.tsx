import React from 'react';
import { useTranslation } from 'react-i18next';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, SafetyText } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { ScrollView } from '../../components/ui/scroll-view';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { SessionProfile } from '../../components/ui/session-profile';
import type { MobileDiveSession } from '../../types/dive-session';
import { formatDate, formatDepth, formatDuration, formatRating } from '../../utils/dive-formatters';
import { getSessionDurationSeconds, getSessionMaxDepthMeters } from '../../utils/session-summary';

type MemoryScreenProps = {
  sessions: MobileDiveSession[];
  onOpenLogbook: () => void;
};

export default function MemoryScreen(props: MemoryScreenProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const session = props.sessions[0];
  const maxDepthMeters = session ? getSessionMaxDepthMeters(session) : undefined;
  const durationSeconds = session ? getSessionDurationSeconds(session) : undefined;
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const knownDurations = props.sessions.map(getSessionDurationSeconds).filter(isNumber);
  const totalDuration = knownDurations.length ? knownDurations.reduce((sum, value) => sum + value, 0) : undefined;
  const knownMaxDepths = props.sessions.map(getSessionMaxDepthMeters).filter(isNumber);
  const averageMaxDepth = knownMaxDepths.length ? knownMaxDepths.reduce((sum, value) => sum + value, 0) / knownMaxDepths.length : undefined;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="px-5 pt-4 pb-6" contentInsetAdjustmentBehavior="automatic">
      <VStack space="lg">
        <Text className="text-3xl font-semibold text-foreground">{t('memory.title')}</Text>

        <DiveSummaryCard accent="primary">
          <DiveSummaryCard.Header
            title={session?.siteName ?? t('memory.importDive')}
            right={
              <Text className="text-sm font-semibold text-muted-foreground">
                {formatDate(session?.startedAt, locale, t('formatters.unknownDate'))}
              </Text>
            }
          />
          <DiveSummaryCard.Body>
            <HStack space="md">
              <ShareMetric label={t('memory.max')} value={formatDepth(maxDepthMeters)} />
              <ShareMetric label={t('memory.time')} value={formatOptionalDuration(durationSeconds)} />
            </HStack>
            <SessionProfile samples={session?.samples ?? []} kind="depth" title={t('logbook.depthProfile')} />
            <HStack className="items-center justify-between">
              <Text
                accessibilityLabel={
                  session?.rating ? t('form.ratingStar', { value: session.rating, total: 5 }) : t('formatters.notRated')
                }
                className="text-sm font-semibold text-primary">
                {formatRating(session?.rating, t('formatters.notRated'))}
              </Text>
              <Text className="flex-1 text-right text-xs font-semibold leading-4 text-muted-foreground">
                {session?.tags?.join(' · ') ?? t('memory.fallbackTags')}
              </Text>
            </HStack>
          </DiveSummaryCard.Body>
        </DiveSummaryCard>

        <DiveSummaryCard accent="primary">
          <DiveSummaryCard.Header title={t('memory.reviewSummaries')} />
          <DiveSummaryCard.Body>
            <DiveSummaryCard.Metric label={t('memory.loggedDives')} value={`${props.sessions.length}`} />
            <DiveSummaryCard.Metric label={t('memory.totalBottomTime')} value={formatOptionalDuration(totalDuration)} />
            <DiveSummaryCard.Metric label={t('memory.avgMaxDepth')} value={formatDepth(averageMaxDepth)} />
            <DiveSummaryCard.Metric
              label={t('memory.favoriteMode')}
              value={
                session?.diveMode
                  ? t(`diveModes.${session.diveMode}`, { defaultValue: session.diveMode })
                  : t('memory.recreational')
              }
            />
          </DiveSummaryCard.Body>
        </DiveSummaryCard>

        <InstrumentButton label={t('memory.openLogbook')} onPress={props.onOpenLogbook} />

        <SafetyText>{t('memory.safetyText')}</SafetyText>
      </VStack>
    </ScrollView>
  );
}

function ShareMetric(props: { label: string; value: string }): React.JSX.Element {
  return (
    <VStack space="xs" className="flex-1 rounded-2xl bg-muted px-4 py-4">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
      <Text className="text-2xl font-semibold text-foreground">{props.value}</Text>
    </VStack>
  );
}

function formatOptionalDuration(seconds: number | undefined): string {
  return seconds === undefined ? '--:--' : formatDuration(seconds);
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}
