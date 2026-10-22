import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Section, Row } from '../../components/ui/grouped-list';
import { HStack } from '../../components/ui/hstack';
import { InstrumentButton, SafetyText, ScreenBackButton, StatusPill } from '../../components/ui/instrument';
import { ScreenHeader } from '../../components/ui/screen-header';
import { SyncConflictBanner, type SyncConflictChoice } from '../../components/ui/sync-conflict-banner';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import type { DiveFieldSource, DiveLogEntry } from '../../types/dive-log-entry';
import type { WatchSession, WatchSessionCommon } from '../../types/dive-session';
import { confirmDestructiveAction } from '../../utils/confirm-destructive-action';
import { firstNonBlankText } from '../../utils/notes';
import { getUnsupportedDepthForLogEntry } from '../../utils/unsupported-depth';
import { getVisibleLogTags, isUntouchedWatchPressureDefault } from '../../utils/watch-session-to-dive-log-entry';
import { RowSeparator } from '../common/form/field-row';
import {
  formatLogDate,
  formatLogDepth,
  formatLogDuration,
  formatLogPressure,
  formatLogPressureSpoken,
  formatLogScale,
  formatLogTemperature,
  getLogDisplayTitle,
  getLogMeasuredValue,
  getLogStartedAt,
  toTestIdValue,
} from './log-formatters';
import { LogEntryProfile, LogEntryProfileSkeleton } from './log-entry-profile';

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
  /** True while the full watch profile is still being read; the profile slot shows a skeleton. */
  isProfileLoading?: boolean;
  onBack?: () => void;
  onEdit?: (entry: DiveLogEntry) => void;
  onDelete?: (localId: string) => Promise<void>;
  onResolveConflict?: (choice: SyncConflictChoice) => Promise<void>;
};

type TranslateFn = ReturnType<typeof useTranslation>['t'];

/**
 * One log: title with its source, a summary group (2-3 facts and one depth profile), the watch
 * record, grouped label/value rows that hide when empty, and delete in its own group at the end.
 */
export function LogEntryDetail(props: LogEntryDetailProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { entry } = props;
  const isDemoCapture = entry.watchCapture?.session.captureMode === 'demo';
  const isDebugTestCapture = entry.watchCapture?.session.tags?.includes('debug-test-capture') ?? false;
  const note = firstNonBlankText(entry.manual.notes, entry.watchCapture?.session.notes);
  const rows = getDetailRows(entry, t);

  return (
    <VStack testID="log-entry-detail" space="lg">
      {props.onBack || props.onEdit ? (
        <HStack className="items-center justify-between">
          {props.onBack ? (
            <ScreenBackButton testID="log-entry-detail-back" accessibilityLabel={t('common.back')} onPress={props.onBack} />
          ) : (
            <VStack />
          )}
          {props.onEdit ? (
            <InstrumentButton
              testID="log-entry-detail-edit"
              label={t('logbook.editLog')}
              onPress={() => props.onEdit?.(entry)}
              className="min-h-11 px-4 py-2"
            />
          ) : null}
        </HStack>
      ) : null}
      <VStack space="sm">
        <ScreenHeader title={getLogDisplayTitle(entry, t, locale)} titleTestID="log-entry-detail-title" />
        <HStack space="sm" className="flex-wrap items-center">
          <StatusPill
            testID="log-entry-detail-source"
            label={entry.source === 'watch' ? t('logbook.watchSource') : t('logbook.manualSource')}
            tone="muted"
          />
          {isDemoCapture ? (
            <StatusPill
              testID={isDebugTestCapture ? 'log-entry-detail-test-capture' : 'log-entry-detail-demo-capture'}
              label={isDebugTestCapture ? t('logbook.testCapture') : t('logbook.demoCapture')}
              tone="muted"
            />
          ) : null}
          <Text testID="log-entry-detail-date" className="text-sm leading-5 text-muted-foreground">
            {formatLogDate(getLogStartedAt(entry), locale, t('formatters.unknownDate'))}
          </Text>
        </HStack>
      </VStack>
      {entry.cloudSyncStatus === 'conflict' && props.onResolveConflict ? (
        <SyncConflictBanner onResolve={props.onResolveConflict} />
      ) : null}
      <SummaryGroup entry={entry} profileSamples={props.profileSamples} isProfileLoading={props.isProfileLoading} />
      <WatchRecordGroup entry={entry} profileSamples={props.profileSamples} />
      {rows.length ? (
        <Section title={t('logbook.detailsSection')}>
          {rows.map((row, index) => (
            <Row
              key={row.id}
              label={row.label}
              value={row.value}
              accessibilityLabel={`${row.label}, ${row.spokenValue ?? row.value}`}
              valueTestID={`log-entry-detail-mode-value-${row.id}-${toTestIdValue(row.value)}`}
              separated={index > 0}
            />
          ))}
        </Section>
      ) : null}
      {note ? (
        <Section title={t('logbook.notes')}>
          <Text testID="log-entry-detail-note" className="px-4 py-3 text-base leading-6 text-card-foreground">
            {note}
          </Text>
        </Section>
      ) : null}
      {props.onDelete ? <DeleteGroup entry={entry} onDelete={props.onDelete} /> : null}
      <SafetyText>{t('logbook.safetyText')}</SafetyText>
    </VStack>
  );
}

/** Max depth, dive time and water temperature when known, and one depth profile. */
function SummaryGroup(props: {
  entry: DiveLogEntry;
  profileSamples?: WatchSession['samples'];
  isProfileLoading?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const maxDepth = getLogMeasuredValue(props.entry, 'maxDepthMeters');
  const duration = getLogMeasuredValue(props.entry, 'durationSeconds');
  const waterTemperature = getLogMeasuredValue(props.entry, 'waterTemperatureCelsius');
  const samples = props.profileSamples ?? props.entry.watchCapture?.samples ?? [];
  const unsupportedDepth = getUnsupportedDepthForLogEntry(props.entry);
  const isWatchEntry = props.entry.watchCapture !== undefined;

  return (
    <VStack testID="log-entry-detail-summary" space="lg" className="rounded-2xl bg-card px-4 py-4">
      <HStack space="md">
        <SummaryFact
          label={t('logbook.maxDepth')}
          value={formatLogDepth(maxDepth.value)}
          source={maxDepth.source}
          showsOverride={isWatchEntry}
          testID="log-entry-detail-provenance-max-depth"
          valueTestID="log-entry-detail-max-depth-value"
        />
        <SummaryFact
          label={t('logbook.duration')}
          value={formatLogDuration(duration.value, t)}
          source={duration.source}
          showsOverride={isWatchEntry}
          valueTestID="log-entry-detail-duration-value"
        />
        {waterTemperature.value !== undefined ? (
          <SummaryFact
            label={t('logbook.waterTemp')}
            value={formatLogTemperature(waterTemperature.value)}
            source={waterTemperature.source}
            showsOverride={isWatchEntry}
          />
        ) : null}
      </HStack>
      {unsupportedDepth ? (
        <Text
          testID="log-entry-detail-unsupported-depth-warning"
          className="rounded-xl bg-muted px-3 py-2 text-sm leading-5 text-muted-foreground">
          {t('logbook.unsupportedDepthWarning')}
        </Text>
      ) : null}
      {samples.length ? (
        <LogEntryProfile samples={samples} kind="depth" title={t('logbook.depthProfile')} testID="log-entry-detail-depth-profile" />
      ) : props.isProfileLoading && isWatchEntry ? (
        <LogEntryProfileSkeleton scope={props.entry.localId} title={t('logbook.depthProfile')} />
      ) : null}
    </VStack>
  );
}

function SummaryFact(props: {
  label: string;
  value: string;
  source: DiveFieldSource;
  /** On a watch log, a value the user changed carries a quiet marker. Manual logs need none. */
  showsOverride: boolean;
  testID?: string;
  valueTestID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const isOverride = props.showsOverride && props.source === 'manual';

  return (
    <VStack
      testID={props.testID ? `${props.testID}-${props.source}` : undefined}
      space="xs"
      className="flex-1"
      accessible
      accessibilityLabel={[props.label, props.value, isOverride ? t('logbook.manualOverride') : undefined].filter(Boolean).join(', ')}>
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{props.label}</Text>
      <Text
        testID={props.valueTestID ? `${props.valueTestID}-${toTestIdValue(props.value)}` : undefined}
        className="text-xl font-semibold leading-7 text-card-foreground">
        {props.value}
      </Text>
      {isOverride ? <Text className="text-xs text-muted-foreground">{t('logbook.manualOverride')}</Text> : null}
    </VStack>
  );
}

/** What only the watch recorded: the recommended-stop review, freedive session facts, temperature. */
function WatchRecordGroup(props: { entry: DiveLogEntry; profileSamples?: WatchSession['samples'] }): React.JSX.Element | null {
  const { t } = useTranslation();
  const session = props.entry.watchCapture?.session;

  if (!session) {
    return null;
  }

  const samples = props.profileSamples ?? props.entry.watchCapture?.samples ?? [];
  const hasTemperatureSamples = samples.some(sample => sample.waterTemperatureCelsius !== undefined);
  const scuba = session.diveMode === 'scuba' && session.scuba ? <WatchScubaRows session={session} /> : null;
  const freedive = session.diveMode === 'freedive' && session.freedive ? <WatchFreediveRows session={session} /> : null;

  if (!scuba && !freedive && !hasTemperatureSamples) {
    return null;
  }

  return (
    <Section testID="log-entry-detail-watch-mode-metadata" title={t('logbook.watchRecordSection')}>
      {scuba}
      {freedive}
      {hasTemperatureSamples ? (
        <VStack>
          {scuba || freedive ? <RowSeparator /> : null}
          <VStack className="px-4 py-3">
            <LogEntryProfile
              samples={samples}
              kind="temperature"
              title={t('logbook.temperatureProfile')}
              testID="log-entry-detail-temperature-profile"
            />
          </VStack>
        </VStack>
      ) : null}
    </Section>
  );
}

type SafetyStopStatus = NonNullable<WatchSession['scuba']>['safetyStop']['status'];
type StatusPillTone = React.ComponentProps<typeof StatusPill>['tone'];

/** Statuses that mean a recommended stop was armed during the dive, so the review pill applies. */
const ARMED_SAFETY_STOP_STATUSES: SafetyStopStatus[] = ['armed', 'active', 'pausedTooDeep', 'pausedTooShallow', 'completed', 'skippedOrIncomplete'];

function WatchScubaRows(props: { session: WatchSessionCommon }): React.JSX.Element {
  const { t } = useTranslation();
  const safetyStop = props.session.scuba!.safetyStop;
  // A status this build does not know reads as unknown, never as its raw code.
  const statusLabel = t(`logbook.watchScuba.safetyStopStatuses.${safetyStop.status}`, { defaultValue: '--' });
  const wasArmed = ARMED_SAFETY_STOP_STATUSES.includes(safetyStop.status);

  return (
    <>
      {/* Post-dive review of a non-certified reminder: amber for an unfinished stop, never red. */}
      <HStack
        space="md"
        className="min-h-12 items-center px-4 py-3"
        accessible
        accessibilityLabel={`${t('logbook.watchScuba.safetyStopRecommended')}, ${statusLabel}`}>
        <Text className="flex-1 text-base text-card-foreground">{t('logbook.watchScuba.safetyStopRecommended')}</Text>
        {wasArmed ? (
          <StatusPill testID="log-entry-detail-safety-stop-pill" label={statusLabel} tone={getSafetyStopTone(safetyStop.status)} />
        ) : (
          <Text className="text-base text-muted-foreground">{statusLabel}</Text>
        )}
      </HStack>
      {wasArmed && safetyStop.remainingSeconds > 0 ? (
        <Row
          label={t('logbook.watchScuba.remaining')}
          value={formatLogDuration(safetyStop.remainingSeconds, t)}
          valueTestID={`log-entry-detail-watch-mode-value-remaining-${safetyStop.remainingSeconds}`}
        />
      ) : null}
      {safetyStop.timeInZoneSeconds > 0 ? (
        <Row
          label={t('logbook.watchScuba.timeInZone')}
          value={formatLogDuration(safetyStop.timeInZoneSeconds, t)}
          valueTestID={`log-entry-detail-watch-mode-value-time-in-zone-${safetyStop.timeInZoneSeconds}`}
        />
      ) : null}
    </>
  );
}

function WatchFreediveRows(props: { session: WatchSessionCommon }): React.JSX.Element {
  const { t } = useTranslation();
  const freedive = props.session.freedive!;
  const recentSegments = [...freedive.segments].sort((left, right) => left.index - right.index).slice(-3);
  const surfaceIntervalSeconds = getRecentSurfaceIntervalSeconds(freedive.segments);

  return (
    <>
      <Row
        label={t('logbook.watchFreedive.diveCount')}
        value={`${freedive.diveCount}`}
        valueTestID={`log-entry-detail-watch-mode-value-dive-count-${freedive.diveCount}`}
        separated={false}
      />
      <Row label={t('logbook.watchFreedive.longestDive')} value={formatLogDuration(freedive.longestDiveDurationSeconds, t)} />
      {surfaceIntervalSeconds === undefined ? null : (
        <Row label={t('logbook.watchFreedive.surfaceInterval')} value={formatLogDuration(surfaceIntervalSeconds, t)} />
      )}
      {recentSegments.map(segment => (
        <Row
          key={segment.segmentId}
          label={t('logbook.watchFreedive.segmentLabel', { index: String(segment.index).padStart(2, '0') })}
          value={`${formatLogDuration(segment.durationSeconds, t)} · ${formatLogDepth(segment.maxDepthMeters)}`}
        />
      ))}
    </>
  );
}

type DetailRow = {
  id: string;
  label: string;
  value: string;
  spokenValue?: string;
};

/** Grouped rows for what the diver recorded. A row with no value is left out. */
function getDetailRows(entry: DiveLogEntry, t: TranslateFn): DetailRow[] {
  const measuredValues = entry.manual.measuredValues;
  const diveMode = measuredValues.diveMode ?? entry.watchCapture?.session.diveMode;
  const rating = entry.manual.rating;
  const isScuba = diveMode === 'scuba';
  const isFreedive = diveMode === 'freedive';
  const listText = (values: string[]) => (values.length ? values.join(', ') : undefined);

  return compactRows([
    { id: 'dive-mode', label: t('logbook.diveMode'), value: diveMode ? t(`diveModes.${diveMode}`) : undefined },
    rating
      ? {
          id: 'rating',
          label: t('logbook.rating'),
          value: t('form.ratingStar', { value: rating, total: 5 }),
        }
      : undefined,
    {
      id: 'entry-style',
      label: t('logbook.entryStyle'),
      value: entry.manual.entryStyle ? t(`entryStyles.${entry.manual.entryStyle}`) : undefined,
    },
    isScuba ? { id: 'gas-label', label: t('logbook.gasLabel'), value: formatGasLabel(measuredValues.gasLabel, t) } : undefined,
    isScuba ? { id: 'gear', label: t('logbook.gear'), value: listText(entry.manual.gearIds) } : undefined,
    isScuba
      ? {
          id: 'water-condition',
          label: t('logbook.waterCondition'),
          value:
            measuredValues.waterCondition && measuredValues.waterCondition !== 'unknown'
              ? t(`waterConditions.${measuredValues.waterCondition}`)
              : undefined,
        }
      : undefined,
    isScuba ? { id: 'visibility-rating', label: t('logbook.visibilityRating'), value: formatLogScale(measuredValues.visibilityRating) } : undefined,
    { id: 'perceived-exertion', label: t('logbook.perceivedExertion'), value: formatLogScale(measuredValues.perceivedExertion) },
    // The watch does not measure tank pressure, so its untouched import default is not shown.
    isScuba && !isUntouchedWatchPressureDefault(entry)
      ? {
          id: 'pressure',
          label: t('logbook.pressure'),
          value: formatLogPressure(measuredValues.pressure),
          spokenValue: formatLogPressureSpoken(measuredValues.pressure, t),
        }
      : undefined,
    isFreedive
      ? {
          id: 'repetition-count',
          label: t('logbook.repetitionCount'),
          value: measuredValues.repetitionCount === undefined ? undefined : `${measuredValues.repetitionCount}`,
        }
      : undefined,
    isFreedive ? { id: 'training-focus', label: t('logbook.trainingFocus'), value: measuredValues.trainingFocus } : undefined,
    { id: 'buddies', label: t('logbook.buddyNames'), value: listText(entry.manual.buddyIds) },
    { id: 'tags', label: t('logbook.tags'), value: listText(getVisibleLogTags(entry)) },
    { id: 'marine-life', label: t('logbook.observedMarineLife'), value: listText(entry.manual.observedMarineLife) },
  ]);
}

/** The stored gas is the literal `Air`; it reads in the current language. Any other label shows as stored. */
function formatGasLabel(gasLabel: string | undefined, t: TranslateFn): string {
  return !gasLabel || gasLabel.trim().toLowerCase() === 'air' ? t('logbook.airGas') : gasLabel;
}

function compactRows(rows: Array<{ id: string; label: string; value: string | undefined; spokenValue?: string } | undefined>): DetailRow[] {
  return rows.filter((row): row is DetailRow => Boolean(row?.value));
}

/** Delete sits apart from everything else. It shows progress while running and says when it failed. */
function DeleteGroup(props: { entry: DiveLogEntry; onDelete: (localId: string) => Promise<void> }): React.JSX.Element {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteFailed, setDeleteFailed] = React.useState(false);
  const { entry, onDelete } = props;

  const runDelete = React.useCallback(async () => {
    setIsDeleting(true);
    setDeleteFailed(false);
    try {
      await onDelete(entry.localId);
      // On success the screen is leaving, so the row stays pending until it is gone.
    } catch {
      setIsDeleting(false);
      setDeleteFailed(true);
      AccessibilityInfo.announceForAccessibility(t('logbook.deleteError'));
    }
  }, [entry.localId, onDelete, t]);

  const confirmDelete = React.useCallback(() => {
    confirmDestructiveAction({
      title: t('logbook.deleteConfirm.title'),
      message: t(deleteLogMessageKey(entry)),
      cancelLabel: t('common.cancel'),
      confirmLabel: t('logbook.deleteConfirm.confirm'),
      onConfirm: () => {
        void runDelete();
      },
    });
  }, [entry, runDelete, t]);

  // Busy and disabled from the tap; the row's spinner appears only after the shared 1 s delay.
  return (
    <VStack space="sm">
      <Section>
        <Row
          testID="log-entry-detail-delete"
          label={t('logbook.deleteLog')}
          destructive
          accessory={{ kind: 'none' }}
          pending={isDeleting}
          onPress={confirmDelete}
          separated={false}
        />
      </Section>
      {deleteFailed ? (
        <Text
          testID="log-entry-detail-delete-error"
          accessibilityLiveRegion="polite"
          className="px-1 text-sm leading-5 text-destructive">
          {t('logbook.deleteError')}
        </Text>
      ) : null}
    </VStack>
  );
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

/** A recommended stop that did not finish is a caution, never the danger tone reserved for errors. */
function getSafetyStopTone(status: SafetyStopStatus): StatusPillTone {
  if (status === 'completed') {
    return 'success';
  }

  if (
    status === 'skippedOrIncomplete' ||
    status === 'active' ||
    status === 'armed' ||
    status === 'pausedTooDeep' ||
    status === 'pausedTooShallow'
  ) {
    return 'warning';
  }

  return 'muted';
}
