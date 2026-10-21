import { z } from 'zod';
import {
  numberValidationMessages,
  validationText,
  type NumberValidationMessages,
  type ValidationField,
} from '../common/form/validation-messages';
import type { DiveEntryStyle } from '../../types/dive-plan';
import type { DiveLogEntry, DiveLogFieldProvenance, DiveLogManualMeasuredValues, DivePressureValues } from '../../types/dive-log-entry';
import type { WatchSession } from '../../types/dive-session';

export type LogEntryFormValues = {
  startedAt: Date | undefined;
  diveMode: NonNullable<WatchSession['diveMode']>;
  entryStyle?: DiveEntryStyle;
  siteName: string;
  durationSeconds: number | undefined;
  maxDepthMeters: number | undefined;
  gasLabel?: 'Air';
  gearIds: string[];
  waterCondition?: WatchSession['waterCondition'];
  visibilityRating?: number;
  perceivedExertion?: number;
  repetitionCount?: number;
  trainingFocus?: string;
  buddies: string[];
  tags: string[];
  observedMarineLife: string[];
  notes?: string;
  rating?: number;
  pressure: DivePressureValues;
};

export type LogEntryDirtyFields = Partial<Record<keyof LogEntryFormValues, unknown>>;

const waterConditions = ['calm', 'mild', 'choppy', 'surge', 'current', 'unknown'] as const;

const requiredNumber = (messages: () => NumberValidationMessages, max: number) =>
  z.union([z.number(), z.undefined()]).superRefine((value, context) => {
    if (value === undefined) {
      context.addIssue({ code: 'custom', message: messages().required });
      return;
    }

    addNumberIssues(value, context, messages(), max);
  });

const optionalNumber = (messages: () => NumberValidationMessages, max: number) =>
  z.union([z.number(), z.undefined()]).superRefine((value, context) => {
    if (value !== undefined) {
      addNumberIssues(value, context, messages(), max);
    }
  });

const optionalRating = z.union([z.number(), z.undefined()]).superRefine((value, context) => {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    context.addIssue({ code: 'custom', message: validationText('ratingRange') });
  }
});

const pressureSchema = z
  .object({
    unit: z.enum(['bar', 'psi']).optional(),
    start: z.number().optional(),
    end: z.number().optional(),
  })
  .superRefine((value, context) => {
    const unit = value.unit ?? 'bar';
    const max = unit === 'psi' ? 4500 : 300;

    validatePressureValue(value.start, ['start'], context, makePressureMessages(unit, 'startPressure'), max);
    validatePressureValue(value.end, ['end'], context, makePressureMessages(unit, 'endPressure'), max);

    if ((value.start !== undefined || value.end !== undefined) && value.unit === undefined) {
      context.addIssue({ code: 'custom', path: ['unit'], message: validationText('pressureUnitRequired') });
    }
  });

export const logEntryFormSchema = z.object({
  startedAt: z.union([z.date(), z.undefined()]).superRefine((value, context) => {
    if (value === undefined) {
      context.addIssue({ code: 'custom', message: validationText('dateTimeRequired') });
    }
  }),
  diveMode: z.enum(['scuba', 'freedive']),
  entryStyle: z.enum(['shore', 'boat', 'pool']).optional(),
  siteName: z.string().trim().min(1, { error: () => validationText('siteNameRequired') }),
  durationSeconds: requiredNumber(() => makeNumberMessages('duration', 'select'), 240 * 60),
  maxDepthMeters: requiredNumber(() => makeNumberMessages('maxDepth', 'select'), 60),
  gasLabel: z.literal('Air').optional(),
  gearIds: z.array(z.string()),
  waterCondition: z.enum(waterConditions).optional(),
  visibilityRating: optionalRating,
  perceivedExertion: optionalRating,
  repetitionCount: optionalNumber(() => makeNumberMessages('repetitionCount', 'select'), 200),
  trainingFocus: z.string().optional(),
  buddies: z.array(z.string()),
  tags: z.array(z.string()),
  observedMarineLife: z.array(z.string()),
  notes: z.string().optional(),
  rating: optionalRating,
  pressure: pressureSchema,
});

export function entryToLogEntryFormValues(entry: DiveLogEntry): LogEntryFormValues {
  const measuredValues = entry.manual.measuredValues;
  const diveMode = measuredValues.diveMode ?? 'scuba';

  return {
    startedAt: new Date(getEditorStartedAt(entry) * 1000),
    diveMode,
    entryStyle: entry.manual.entryStyle,
    siteName: entry.manual.site.name ?? '',
    durationSeconds: getEditorNumber(entry, 'durationSeconds'),
    maxDepthMeters: getEditorNumber(entry, 'maxDepthMeters'),
    gasLabel: diveMode === 'scuba' ? 'Air' : undefined,
    gearIds: [...entry.manual.gearIds],
    waterCondition: measuredValues.waterCondition,
    visibilityRating: measuredValues.visibilityRating,
    perceivedExertion: measuredValues.perceivedExertion,
    repetitionCount: measuredValues.repetitionCount,
    trainingFocus: measuredValues.trainingFocus ?? '',
    buddies: [...entry.manual.buddyIds],
    tags: [...entry.manual.tags],
    observedMarineLife: [...entry.manual.observedMarineLife],
    notes: entry.manual.notes ?? '',
    rating: entry.manual.rating,
    pressure: pressureToFormValue(measuredValues.pressure),
  };
}

export function logEntryFormValuesToEntry(
  entry: DiveLogEntry,
  values: LogEntryFormValues,
  dirtyFields: LogEntryDirtyFields,
): DiveLogEntry {
  const diveMode = values.diveMode;
  const measuredValues: DiveLogManualMeasuredValues = {
    averageDepthMeters: entry.manual.measuredValues.averageDepthMeters,
    endedAt: entry.manual.measuredValues.endedAt,
    waterTemperatureCelsius: entry.manual.measuredValues.waterTemperatureCelsius,
    diveMode,
  };
  const provenance: DiveLogFieldProvenance = {
    ...entry.provenance,
    site: 'manual',
    buddyIds: 'manual',
    gearIds: 'manual',
    tags: 'manual',
    observedMarineLife: 'manual',
    notes: 'manual',
    rating: 'manual',
    measuredValues: 'manual',
  };

  applyStartedAtValue(entry, measuredValues, provenance, values, dirtyFields);
  applyEditableNumberValue(entry, measuredValues, provenance, {
    field: 'durationSeconds',
    draftKey: 'durationSeconds',
    value: values.durationSeconds,
    dirtyFields,
    visible: true,
  });
  applyEditableNumberValue(entry, measuredValues, provenance, {
    field: 'maxDepthMeters',
    draftKey: 'maxDepthMeters',
    value: values.maxDepthMeters,
    dirtyFields,
    visible: true,
  });
  applyModeSpecificValues(entry, measuredValues, provenance, values, diveMode, dirtyFields);

  return {
    ...entry,
    source: entry.watchCapture ? 'watch' : 'manual',
    cloudSyncStatus: entry.cloudSyncStatus,
    updatedAt: Date.now() / 1000,
    manual: {
      ...entry.manual,
      site: {
        ...entry.manual.site,
        name: emptyToUndefined(values.siteName),
      },
      entryStyle: values.entryStyle,
      buddyIds: [...values.buddies],
      gearIds: diveMode === 'scuba' ? [...values.gearIds] : [],
      tags: [...values.tags],
      observedMarineLife: [...values.observedMarineLife],
      notes: emptyToUndefined(values.notes ?? ''),
      rating: values.rating,
      measuredValues,
    },
    provenance,
  };
}

function makeNumberMessages(field: ValidationField, requiredVerb: 'enter' | 'select'): NumberValidationMessages {
  return numberValidationMessages(field, requiredVerb);
}

function makePressureMessages(unit: 'bar' | 'psi', field: ValidationField): NumberValidationMessages {
  return numberValidationMessages(field, 'enter', unit);
}

function addNumberIssues(value: number, context: z.RefinementCtx, messages: NumberValidationMessages, max: number): void {
  if (!Number.isFinite(value)) {
    context.addIssue({ code: 'custom', message: messages.invalid });
    return;
  }

  if (value < 0) {
    context.addIssue({ code: 'custom', message: messages.min });
    return;
  }

  if (value > max) {
    context.addIssue({ code: 'custom', message: messages.max.replace('{max}', `${max}`) });
  }
}

function validatePressureValue(
  value: number | undefined,
  path: Array<string | number>,
  context: z.RefinementCtx,
  messages: NumberValidationMessages,
  max: number,
): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isFinite(value)) {
    context.addIssue({ code: 'custom', path, message: messages.invalid });
    return;
  }

  if (value < 0) {
    context.addIssue({ code: 'custom', path, message: messages.min });
    return;
  }

  if (value > max) {
    context.addIssue({ code: 'custom', path, message: messages.max.replace('{max}', `${max}`) });
  }
}

function getEditorStartedAt(entry: DiveLogEntry): number {
  if (entry.provenance.startedAt === 'manual' && entry.manual.measuredValues.startedAt !== undefined) {
    return entry.manual.measuredValues.startedAt;
  }

  return entry.watchCapture?.measuredValues.startedAt ?? entry.manual.measuredValues.startedAt ?? entry.createdAt;
}

function getEditorNumber(entry: DiveLogEntry, field: 'durationSeconds' | 'maxDepthMeters'): number | undefined {
  const manualValue = entry.manual.measuredValues[field];

  if (entry.provenance[field] === 'manual' && manualValue !== undefined) {
    return manualValue;
  }

  return entry.watchCapture?.measuredValues[field] ?? manualValue;
}

function applyStartedAtValue(
  entry: DiveLogEntry,
  measuredValues: DiveLogManualMeasuredValues,
  provenance: DiveLogFieldProvenance,
  values: LogEntryFormValues,
  dirtyFields: LogEntryDirtyFields,
): void {
  const parsedStartedAt = values.startedAt === undefined ? undefined : values.startedAt.getTime() / 1000;

  if (!entry.watchCapture) {
    measuredValues.startedAt = parsedStartedAt ?? entry.manual.measuredValues.startedAt ?? entry.createdAt;
    provenance.startedAt = 'manual';
    return;
  }

  if (isDirty(dirtyFields, 'startedAt')) {
    if (parsedStartedAt !== undefined) {
      measuredValues.startedAt = parsedStartedAt;
      provenance.startedAt = 'manual';
    } else {
      provenance.startedAt = 'watch';
    }
    return;
  }

  if (entry.provenance.startedAt === 'manual' && entry.manual.measuredValues.startedAt !== undefined) {
    measuredValues.startedAt = entry.manual.measuredValues.startedAt;
    provenance.startedAt = 'manual';
    return;
  }

  provenance.startedAt = 'watch';
}

function applyEditableNumberValue(
  entry: DiveLogEntry,
  measuredValues: DiveLogManualMeasuredValues,
  provenance: DiveLogFieldProvenance,
  options: {
    field: 'durationSeconds' | 'maxDepthMeters';
    draftKey: keyof LogEntryFormValues;
    value: number | undefined;
    dirtyFields: LogEntryDirtyFields;
    visible: boolean;
  },
): void {
  if (!options.visible) {
    setWatchFallbackProvenance(entry, provenance, options.field);
    return;
  }

  if (!entry.watchCapture) {
    measuredValues[options.field] = options.value;
    provenance[options.field] = 'manual';
    return;
  }

  if (isDirty(options.dirtyFields, options.draftKey) || didEditableNumberChange(entry, options.field, options.value)) {
    if (options.value !== undefined) {
      measuredValues[options.field] = options.value;
      provenance[options.field] = 'manual';
    } else {
      setWatchFallbackProvenance(entry, provenance, options.field);
    }
    return;
  }

  const manualValue = entry.manual.measuredValues[options.field];

  if (entry.provenance[options.field] === 'manual' && manualValue !== undefined) {
    measuredValues[options.field] = manualValue;
    provenance[options.field] = 'manual';
    return;
  }

  setWatchFallbackProvenance(entry, provenance, options.field);
}

function didEditableNumberChange(
  entry: DiveLogEntry,
  field: 'durationSeconds' | 'maxDepthMeters',
  value: number | undefined,
): boolean {
  if (!entry.watchCapture) {
    return false;
  }

  return getEditorNumber(entry, field) !== value;
}

function setWatchFallbackProvenance(
  entry: DiveLogEntry,
  provenance: DiveLogFieldProvenance,
  field: 'durationSeconds' | 'maxDepthMeters',
): void {
  if (entry.watchCapture?.measuredValues[field] !== undefined) {
    provenance[field] = 'watch';
  } else {
    delete provenance[field];
  }
}

type ModeSpecificMeasuredField =
  | 'gasLabel'
  | 'perceivedExertion'
  | 'visibilityRating'
  | 'waterCondition'
  | 'repetitionCount'
  | 'trainingFocus'
  | 'pressure';

function applyModeMeasuredValue<Field extends ModeSpecificMeasuredField>(
  entry: DiveLogEntry,
  measuredValues: DiveLogManualMeasuredValues,
  provenance: DiveLogFieldProvenance,
  dirtyFields: LogEntryDirtyFields,
  field: Field,
  draftKey: keyof LogEntryFormValues,
  value: DiveLogManualMeasuredValues[Field],
): void {
  const previousValue = entry.manual.measuredValues[field];
  const pressureChanged =
    field === 'pressure' && !arePressureValuesEqual(previousValue as DivePressureValues | undefined, value as DivePressureValues | undefined);

  if (!entry.watchCapture || isDirty(dirtyFields, draftKey) || pressureChanged) {
    measuredValues[field] = value;
    provenance[field] = 'manual';
    return;
  }

  if (previousValue !== undefined) {
    measuredValues[field] = previousValue;
  }
}

function arePressureValuesEqual(left: DivePressureValues | undefined, right: DivePressureValues | undefined): boolean {
  return (
    (left?.unit ?? 'bar') === (right?.unit ?? 'bar') &&
    left?.start === right?.start &&
    left?.end === right?.end
  );
}

function applyModeSpecificValues(
  entry: DiveLogEntry,
  measuredValues: DiveLogManualMeasuredValues,
  provenance: DiveLogFieldProvenance,
  values: LogEntryFormValues,
  diveMode: NonNullable<WatchSession['diveMode']>,
  dirtyFields: LogEntryDirtyFields,
): void {
  if (diveMode === 'scuba') {
    applyModeMeasuredValue(entry, measuredValues, provenance, dirtyFields, 'gasLabel', 'gasLabel', 'Air');
    applyModeMeasuredValue(entry, measuredValues, provenance, dirtyFields, 'waterCondition', 'waterCondition', values.waterCondition);
    applyModeMeasuredValue(entry, measuredValues, provenance, dirtyFields, 'visibilityRating', 'visibilityRating', values.visibilityRating);
    applyModeMeasuredValue(entry, measuredValues, provenance, dirtyFields, 'perceivedExertion', 'perceivedExertion', values.perceivedExertion);
    applyModeMeasuredValue(entry, measuredValues, provenance, dirtyFields, 'pressure', 'pressure', normalizePressure(values.pressure));
  }

  if (diveMode === 'freedive') {
    applyModeMeasuredValue(entry, measuredValues, provenance, dirtyFields, 'repetitionCount', 'repetitionCount', values.repetitionCount);
    applyModeMeasuredValue(entry, measuredValues, provenance, dirtyFields, 'trainingFocus', 'trainingFocus', emptyToUndefined(values.trainingFocus ?? ''));
    applyModeMeasuredValue(entry, measuredValues, provenance, dirtyFields, 'perceivedExertion', 'perceivedExertion', values.perceivedExertion);
  }
}

function normalizePressure(value: DivePressureValues): DivePressureValues | undefined {
  if (value.start === undefined && value.end === undefined) {
    return undefined;
  }

  return {
    unit: value.unit ?? 'bar',
    start: value.start,
    end: value.end,
  };
}

function pressureToFormValue(value: DivePressureValues | undefined): DivePressureValues {
  return {
    ...value,
    unit: value?.unit ?? 'bar',
  };
}

function emptyToUndefined(value: string): string | undefined {
  const trimmedValue = value.trim();
  return trimmedValue.length ? trimmedValue : undefined;
}

function isDirty(dirtyFields: LogEntryDirtyFields, key: keyof LogEntryFormValues): boolean {
  return Boolean(dirtyFields[key]);
}
