import React from 'react';
import { useTranslation } from 'react-i18next';
import { DiveSummaryCard } from '../../components/ui/dive-summary-card';
import { InstrumentButton, ScreenBackButton, StatusPill } from '../../components/ui/instrument';
import { HStack } from '../../components/ui/hstack';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { SessionProfile } from '../../components/ui/session-profile';
import { SyncConflictBanner, type SyncConflictChoice } from '../../components/ui/sync-conflict-banner';
import type { DiveFieldSource, DiveLogEntry, DiveLogManualMeasuredValues, DiveLogWatchMeasuredValues } from '../../types/dive-log-entry';
import type { WatchSession, WatchSessionCommon } from '../../types/dive-session';
import {
  formatDate,
  formatDepth,
  formatDuration,
  formatPressure,
  formatRating,
  formatTemperature,
} from '../../utils/dive-formatters';
import { confirmDestructiveAction } from '../../utils/confirm-destructive-action';
import { firstNonBlankText } from '../../utils/notes';
import { getUnsupportedDepthForLogEntry } from '../../utils/unsupported-depth';

function deleteLogMessageKey(entry: DiveLogEntry): string {
  const removesWatchOriginal = entry.watchCapture !== undefined;
  const removesAccountCopy = entry.ownerUserId !== undefined;

  if (removesWatchOriginal && removesAccountCopy) {
    return 'logbook.deleteConfirm.watchAndAccountMessage';
  }
  if (removesWatchOriginal) {
    return 'logbook.deleteConfirm.watchMessage';
  }
  if (removesAccountCopy) {
    return 'logbook.deleteConfirm.accountMessage';
  }
  return 'logbook.deleteConfirm.message';
}

type LogEntryDetailProps = {
  entry: DiveLogEntry;
  profileSamples?: WatchSession['samples'];
  onBack?: () => void;
  onEdit?: (entry: DiveLogEntry) => void;
  onDelete?: (localId: string) => Promise<void>;
  onResolveConflict?: (choice: SyncConflictChoice) => Promise<void>;
};

export function LogEntryDetail(props: LogEntryDetailProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const startedAt = props.entry.watchCapture?.measuredValues.startedAt ?? props.entry.manual.measuredValues.startedAt ?? props.entry.createdAt;
  const maxDepth = getMeasuredValue(props.entry, 'maxDepthMeters');
  const averageDepth = getMeasuredValue(props.entry, 'averageDepthMeters');
  const waterTemperature = getMeasuredValue(props.entry, 'waterTemperatureCelsius');
  const duration = getMeasuredValue(props.entry, 'durationSeconds');
  const watchSamples = props.profileSamples ?? props.entry.watchCapture?.samples ?? [];
  const hasTemperatureSamples = watchSamples.some(sample => sample.waterTemperatureCelsius !== undefined);
  const unsupportedDepth = getUnsupportedDepthForLogEntry(props.entry);
  const tags = props.entry.manual.tags.length ? props.entry.manual.tags.join(', ') : t('logbook.none');
  const buddies = props.entry.manual.buddyIds.length ? props.entry.manual.buddyIds.join(', ') : t('logbook.none');
  const marineLife = props.entry.manual.observedMarineLife.length ? props.entry.manual.observedMarineLife.join(', ') : t('logbook.none');
  const sourceLabel = props.entry.source === 'watch' ? t('logbook.watchCaptured') : t('logbook.manualValue');
  const isDemoCapture = props.entry.watchCapture?.session.captureMode === 'demo';
  const isDebugTestCapture = props.entry.watchCapture?.session.tags?.includes('debug-test-capture') ?? false;
  const note = firstNonBlankText(props.entry.manual.notes, props.entry.watchCapture?.session.notes) ?? t('logbook.noNotes');
  const headerPills = (
    <HStack space="xs" className="items-center justify-end">
      <StatusPill
        testID="log-entry-detail-source"
        label={props.entry.source === 'watch' ? t('logbook.watchSource') : t('logbook.manualSource')}
        tone="secondary"
      />
      {isDemoCapture ? (
        <StatusPill
          testID={isDebugTestCapture ? 'log-entry-detail-test-capture' : 'log-entry-detail-demo-capture'}
          label={isDebugTestCapture ? t('logbook.testCapture') : t('logbook.demoCapture')}
          tone="warning"
        />
      ) : null}
    </HStack>
  );

  return (
    <DiveSummaryCard accent="primary">
      {props.onBack ? (
        <ScreenBackButton
          testID="log-entry-detail-back"
          accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
          onPress={props.onBack}
        />
      ) : null}
      <DiveSummaryCard.Header
        eyebrow={sourceLabel}
        title={props.entry.manual.title ?? props.entry.manual.site.name ?? t('logbook.detailTitle')}
        right={headerPills}
      />
      <DiveSummaryCard.Body>
        {props.entry.cloudSyncStatus === 'conflict' && props.onResolveConflict ? (
          <SyncConflictBanner onResolve={props.onResolveConflict} />
        ) : null}
        <Text className="text-sm leading-5 text-muted-foreground">
          {formatDate(startedAt, locale, t('formatters.unknownDate'))}
        </Text>
        <HStack space="md">
          <DetailMetric
            label={t('logbook.maxDepth')}
            value={formatDepth(maxDepth.value)}
            source={maxDepth.source}
            testID="log-entry-detail-provenance-max-depth"
            valueTestID="log-entry-detail-max-depth-value"
          />
          <DetailMetric
            label={t('logbook.avgDepth')}
            value={formatDepth(averageDepth.value)}
            source={averageDepth.source}
          />
        </HStack>
        <HStack space="md">
          {waterTemperature.value !== undefined ? (
            <DetailMetric
              label={t('logbook.waterTemp')}
              value={formatTemperature(waterTemperature.value)}
              source={waterTemperature.source}
            />
          ) : null}
          <DetailMetric
            label={t('logbook.duration')}
            value={formatDetailDuration(duration.value)}
            source={duration.source}
            valueTestID="log-entry-detail-duration-value"
          />
        </HStack>
        {unsupportedDepth ? (
          <Text
            testID="log-entry-detail-unsupported-depth-warning"
            className="rounded-xl bg-muted px-4 py-3 text-sm font-semibold leading-5 text-muted-foreground">
            {t('logbook.unsupportedDepthWarning')}
          </Text>
        ) : null}
        {watchSamples.length ? (
          <>
            <SessionProfile
              testID="log-entry-detail-depth-profile"
              samples={watchSamples}
              kind="depth"
              title={t('logbook.depthProfile')}
            />
            {hasTemperatureSamples ? (
              <SessionProfile
                testID="log-entry-detail-temperature-profile"
                samples={watchSamples}
                kind="temperature"
                title={t('logbook.temperatureProfile')}
              />
            ) : null}
          </>
        ) : null}
      </DiveSummaryCard.Body>
      <DiveSummaryCard.Footer>
        <VStack space="sm">
          <Text testID="log-entry-detail-note" className="text-sm leading-5 text-card-foreground">{note}</Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            {t('logbook.buddyNames')}: {buddies}
          </Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            {t('logbook.tags')}: {tags}
          </Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            {t('logbook.observedMarineLife')}: {marineLife}
          </Text>
          <Text className="text-sm leading-5 text-muted-foreground">
            {t('logbook.rating')}: {formatRating(props.entry.manual.rating, t('formatters.notRated'))}
          </Text>
          <ModeSpecificMetadata entry={props.entry} />
          <WatchModeMetadata entry={props.entry} />
          {props.onEdit ? (
            <InstrumentButton testID="log-entry-detail-edit" label={t('logbook.editLog')} variant="primary" onPress={() => props.onEdit?.(props.entry)} />
          ) : null}
          {props.onDelete ? (
            <InstrumentButton
              testID="log-entry-detail-delete"
              label={t('logbook.deleteLog')}
              variant="danger"
              onPress={() =>
                confirmDestructiveAction({
                  title: t('logbook.deleteConfirm.title'),
                  message: t(deleteLogMessageKey(props.entry)),
                  cancelLabel: t('common.cancel'),
                  confirmLabel: t('logbook.deleteConfirm.confirm'),
                  onConfirm: () => {
                    void props.onDelete?.(props.entry.localId);
                  },
                })
              }
            />
          ) : null}
        </VStack>
      </DiveSummaryCard.Footer>
    </DiveSummaryCard>
  );
}

function WatchModeMetadata(props: { entry: DiveLogEntry }): React.JSX.Element | null {
  const session = props.entry.watchCapture?.session;

  if (!session) {
    return null;
  }

  if (session.diveMode === 'freedive' && session.freedive) {
    return <WatchFreediveMetadata session={session} />;
  }

  if (session.diveMode === 'scuba' && session.scuba) {
    return <WatchScubaMetadata session={session} />;
  }

  return null;
}

function WatchFreediveMetadata(props: { session: WatchSessionCommon }): React.JSX.Element {
  const { t } = useTranslation();
  const freedive = props.session.freedive!;
  const recentSegments = [...freedive.segments]
    .sort((left, right) => left.index - right.index)
    .slice(-3);
  const surfaceIntervalSeconds = getRecentSurfaceIntervalSeconds(freedive.segments);
  const facts = compactFacts([
    { id: 'dive-count', label: t('logbook.watchFreedive.diveCount'), value: `${freedive.diveCount}` },
    { id: 'longest-dive', label: t('logbook.watchFreedive.longestDive'), value: formatDetailDuration(freedive.longestDiveDurationSeconds) },
    surfaceIntervalSeconds === undefined
      ? undefined
      : { id: 'surface-interval', label: t('logbook.watchFreedive.surfaceInterval'), value: formatDuration(surfaceIntervalSeconds) },
  ]);

  return (
    <VStack testID="log-entry-detail-watch-mode-metadata" space="sm" className="rounded-2xl bg-muted px-4 py-4">
      <HStack className="items-center justify-between">
        <Text className="text-xs font-semibold uppercase text-muted-foreground">{t('logbook.watchModeDetails')}</Text>
        <StatusPill label={t('logbook.watchFreedive.session')} tone="secondary" />
      </HStack>
      <FactRows facts={facts} testIDPrefix="log-entry-detail-watch-mode-value" />
      {recentSegments.length > 0 ? (
        <VStack space="xs">
          {recentSegments.map(segment => (
            <HStack key={segment.segmentId} className="items-center justify-between">
              <Text className="text-sm leading-5 text-muted-foreground">
                {t('logbook.watchFreedive.segmentLabel', { index: String(segment.index).padStart(2, '0') })}
              </Text>
              <Text className="text-sm font-semibold text-card-foreground">
                {formatDetailDuration(segment.durationSeconds)} · {formatDepth(segment.maxDepthMeters)}
              </Text>
            </HStack>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

function WatchScubaMetadata(props: { session: WatchSessionCommon }): React.JSX.Element {
  const { t } = useTranslation();
  const safetyStop = props.session.scuba!.safetyStop;
  const facts = compactFacts([
    {
      id: 'status',
      label: t('logbook.watchScuba.safetyStopStatus'),
      value: getSafetyStopStatusLabel(safetyStop.status, t),
    },
    safetyStop.remainingSeconds > 0
      ? {
          id: 'remaining',
          label: t('logbook.watchScuba.remaining'),
          value: formatDuration(safetyStop.remainingSeconds),
        }
      : undefined,
    safetyStop.timeInZoneSeconds > 0
      ? {
          id: 'time-in-zone',
          label: t('logbook.watchScuba.timeInZone'),
          value: formatDuration(safetyStop.timeInZoneSeconds),
        }
      : undefined,
  ]);

  return (
    <VStack testID="log-entry-detail-watch-mode-metadata" space="sm" className="rounded-2xl bg-muted px-4 py-4">
      <HStack className="items-center justify-between">
        <Text className="text-xs font-semibold uppercase text-muted-foreground">{t('logbook.watchModeDetails')}</Text>
        <StatusPill label={t('logbook.watchScuba.safetyStopRecommended')} tone={getSafetyStopTone(safetyStop.status)} />
      </HStack>
      <FactRows facts={facts} testIDPrefix="log-entry-detail-watch-mode-value" />
    </VStack>
  );
}

function ModeSpecificMetadata(props: { entry: DiveLogEntry }): React.JSX.Element | null {
  const { t } = useTranslation();
  const facts = getModeFacts(props.entry, t);

  if (facts.length === 0) {
    return null;
  }

  return (
    <VStack space="xs" className="rounded-2xl bg-muted px-4 py-4">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{t('logbook.modeDetails')}</Text>
      <FactRows facts={facts} testIDPrefix="log-entry-detail-mode-value" />
    </VStack>
  );
}

type ModeFact = {
  id: string;
  label: string;
  value: string;
};

function getModeFacts(entry: DiveLogEntry, t: ReturnType<typeof useTranslation>['t']): ModeFact[] {
  const measuredValues = entry.manual.measuredValues;
  const entryStyleFact = entry.manual.entryStyle
    ? {
        id: 'entry-style',
        label: t('logbook.entryStyle', { defaultValue: 'Entry style' }),
        value: t(`entryStyles.${entry.manual.entryStyle}`, { defaultValue: entry.manual.entryStyle }),
      }
    : undefined;

  if (measuredValues.diveMode === 'scuba') {
    return compactFacts([
      entryStyleFact,
      { id: 'gas-label', label: t('logbook.gasLabel'), value: measuredValues.gasLabel ?? t('logbook.airGas', { defaultValue: 'Air' }) },
      { id: 'gear', label: t('logbook.gear'), value: entry.manual.gearIds.length ? entry.manual.gearIds.join(', ') : undefined },
      { id: 'water-condition', label: t('logbook.waterCondition'), value: measuredValues.waterCondition },
      { id: 'visibility-rating', label: t('logbook.visibilityRating'), value: numberToText(measuredValues.visibilityRating) },
      { id: 'perceived-exertion', label: t('logbook.perceivedExertion'), value: numberToText(measuredValues.perceivedExertion) },
      { id: 'pressure', label: t('logbook.pressure', { defaultValue: 'Pressure' }), value: formatPressure(measuredValues.pressure) },
    ]);
  }

  if (measuredValues.diveMode === 'freedive') {
    return compactFacts([
      entryStyleFact,
      { id: 'repetition-count', label: t('logbook.repetitionCount'), value: numberToText(measuredValues.repetitionCount) },
      { id: 'training-focus', label: t('logbook.trainingFocus'), value: measuredValues.trainingFocus },
      { id: 'perceived-exertion', label: t('logbook.perceivedExertion'), value: numberToText(measuredValues.perceivedExertion) },
    ]);
  }

  return [];
}

function compactFacts(facts: Array<{ id: string; label: string; value: string | undefined } | undefined>): ModeFact[] {
  return facts.filter((fact): fact is ModeFact => Boolean(fact?.value));
}

function FactRows(props: { facts: ModeFact[]; testIDPrefix: string }): React.JSX.Element {
  return (
    <>
      {props.facts.map(fact => (
        <HStack key={fact.id} className="items-center justify-between">
          <Text className="text-sm leading-5 text-muted-foreground">{fact.label}</Text>
          <Text
            testID={`${props.testIDPrefix}-${fact.id}-${toTestIdValue(fact.value)}`}
            className="text-sm font-semibold text-card-foreground">
            {fact.value}
          </Text>
        </HStack>
      ))}
    </>
  );
}

function DetailMetric(props: {
  label: string;
  value: string;
  source: DiveFieldSource;
  testID?: string;
  valueTestID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const sourceLabel = props.source === 'watch' ? t('logbook.watchCaptured') : t('logbook.manualValue');
  const testID = props.testID ? `${props.testID}-${props.source}` : undefined;
  const valueTestID = props.valueTestID ? `${props.valueTestID}-${toTestIdValue(props.value)}` : undefined;

  return (
    <VStack testID={testID} space="xs" className="flex-1 rounded-2xl bg-muted px-4 py-4">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
      <Text testID={valueTestID} className="text-lg font-semibold text-foreground">
        {props.value}
      </Text>
      <ProvenanceLabel provenanceLabel={sourceLabel} />
    </VStack>
  );
}

function ProvenanceLabel(props: { provenanceLabel: string }): React.JSX.Element {
  return (
    <Text accessibilityLabel={props.provenanceLabel} className="text-xs font-semibold uppercase text-muted-foreground">
      {props.provenanceLabel}
    </Text>
  );
}

type MeasuredField = 'durationSeconds' | 'maxDepthMeters' | 'averageDepthMeters' | 'waterTemperatureCelsius';

function getMeasuredValue(entry: DiveLogEntry, field: MeasuredField): { value: number | undefined; source: DiveFieldSource } {
  const manualValue = entry.manual.measuredValues[field as keyof DiveLogManualMeasuredValues] as number | undefined;
  const watchValue = entry.watchCapture?.measuredValues[field as keyof DiveLogWatchMeasuredValues] as number | undefined;

  if (entry.provenance[field] === 'manual' && manualValue !== undefined) {
    return { value: manualValue, source: 'manual' };
  }

  if (watchValue !== undefined) {
    return { value: watchValue, source: 'watch' };
  }

  if (manualValue !== undefined) {
    return { value: manualValue, source: 'manual' };
  }

  return { value: undefined, source: entry.provenance[field] ?? (entry.watchCapture ? 'watch' : 'manual') };
}

function formatDetailDuration(seconds: number | undefined): string {
  return seconds === undefined ? '--:--' : formatDuration(seconds);
}

function getRecentSurfaceIntervalSeconds(segments: NonNullable<WatchSession['freedive']>['segments']): number | undefined {
  const sortedSegments = [...segments].sort((left, right) => left.startedAt - right.startedAt);

  if (sortedSegments.length < 2) {
    return undefined;
  }

  const previousSegment = sortedSegments[sortedSegments.length - 2];
  const latestSegment = sortedSegments[sortedSegments.length - 1];

  return Math.max(0, latestSegment.startedAt - previousSegment.endedAt);
}

type SafetyStopStatus = NonNullable<WatchSession['scuba']>['safetyStop']['status'];
type StatusPillTone = React.ComponentProps<typeof StatusPill>['tone'];

function getSafetyStopStatusLabel(status: SafetyStopStatus, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`logbook.watchScuba.safetyStopStatuses.${status}`, { defaultValue: status });
}

function getSafetyStopTone(status: SafetyStopStatus): StatusPillTone {
  if (status === 'completed') {
    return 'success';
  }

  if (status === 'skippedOrIncomplete') {
    return 'danger';
  }

  if (status === 'active' || status === 'armed' || status === 'pausedTooDeep' || status === 'pausedTooShallow') {
    return 'warning';
  }

  return 'muted';
}

function numberToText(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value}`;
}

function toTestIdValue(value: string): string {
  return value.replace(/\s+/g, '');
}
