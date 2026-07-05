import type { WatchDepthSample, WatchSession, WatchSyncMessage } from '../types/dive-session';

export type WatchSyncMessageValidationError = {
  message: string;
  path: string;
};

export type WatchSyncMessageParseResult =
  | { ok: true; message: WatchSyncMessage }
  | { ok: false; error: WatchSyncMessageValidationError };

export type WatchSyncMessagesParseResult =
  | { ok: true; messages: WatchSyncMessage[] }
  | { ok: false; error: WatchSyncMessageValidationError };

const messageTypes = ['sessionCreated', 'sessionUpdated', 'sessionEnded'] as const;
const diveModes = ['scuba', 'freedive'] as const;
const syncStatuses = ['pending', 'synced', 'failed'] as const;
const waterConditions = ['calm', 'mild', 'choppy', 'surge', 'current', 'unknown'] as const;

const messageKeys = ['type', 'session'] as const;
const sessionKeys = [
  'localSessionId',
  'schemaVersion',
  'diveMode',
  'gasLabel',
  'siteId',
  'siteName',
  'sourcePlanLocalId',
  'planTitle',
  'buddyIds',
  'gearIds',
  'tags',
  'notes',
  'rating',
  'perceivedExertion',
  'visibilityRating',
  'waterCondition',
  'syncStatus',
  'entryLocation',
  'exitLocation',
  'startedAt',
  'endedAt',
  'maxDepthMeters',
  'averageDepthMeters',
  'waterTemperatureCelsius',
  'freedive',
  'scuba',
  'samples',
] as const;
const locationKeys = ['latitude', 'longitude', 'horizontalAccuracyMeters', 'capturedAt'] as const;
const freeDiveKeys = ['diveCount', 'maxDepthMeters', 'longestDiveDurationSeconds', 'segments'] as const;
const freeDiveSegmentKeys = [
  'segmentId',
  'index',
  'startedAt',
  'endedAt',
  'durationSeconds',
  'maxDepthMeters',
  'minDepthMeters',
  'sampleStartIndex',
  'sampleEndIndex',
  'descentRateMetersPerSecond',
  'ascentRateMetersPerSecond',
] as const;
const scubaKeys = [
  'gasLabel',
  'maxDepthMeters',
  'averageDepthMeters',
  'waterTemperatureCelsius',
  'latestAscentRateMetersPerMinute',
  'maxAscentRateMetersPerMinute',
  'safetyStop',
] as const;
const safetyStopKeys = [
  'status',
  'required',
  'completed',
  'targetDepthMeters',
  'minDepthMeters',
  'maxDepthMeters',
  'durationSeconds',
  'startedAt',
  'completedAt',
  'remainingSeconds',
  'timeInZoneSeconds',
] as const;
const safetyStopStatuses = [
  'unknown',
  'notRequired',
  'armed',
  'active',
  'pausedTooDeep',
  'pausedTooShallow',
  'completed',
  'skippedOrIncomplete',
] as const;
const sampleKeys = ['localSessionId', 'timestamp', 'depthMeters', 'pressureKPa', 'waterTemperatureCelsius'] as const;

type WatchLocation = NonNullable<WatchSession['entryLocation']>;
type FreeDivePayload = NonNullable<WatchSession['freedive']>;
type FreeDiveSegment = FreeDivePayload['segments'][number];
type ScubaPayload = NonNullable<WatchSession['scuba']>;
type SafetyStopRecord = ScubaPayload['safetyStop'];

export function parseWatchSyncMessageJson(rawJson: string): WatchSyncMessageParseResult {
  try {
    return parseWatchSyncMessageValue(JSON.parse(rawJson) as unknown);
  } catch (error) {
    return failure('$', `Invalid watch sync JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseWatchSyncMessagesJson(rawJson: string): WatchSyncMessagesParseResult {
  try {
    return parseWatchSyncMessagesValue(JSON.parse(rawJson) as unknown);
  } catch (error) {
    return failure('$', `Invalid watch sync JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseWatchSyncMessagesValue(value: unknown): WatchSyncMessagesParseResult {
  if (!Array.isArray(value)) {
    return failure('$', 'Expected an array of watch sync messages');
  }

  const messages: WatchSyncMessage[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const result = parseWatchSyncMessageValue(value[index], `$[${index}]`);
    if (!result.ok) {
      return result;
    }
    messages.push(result.message);
  }

  return { ok: true, messages };
}

export function parseWatchSyncMessageValue(value: unknown, path = '$'): WatchSyncMessageParseResult {
  const objectResult = expectRecord(value, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const keyResult = expectAllowedKeys(objectResult.value, messageKeys, path);
  if (!keyResult.ok) {
    return keyResult;
  }

  const typeResult = readEnum(objectResult.value, 'type', messageTypes, path, { required: true });
  if (!typeResult.ok) {
    return typeResult;
  }
  if (typeResult.value === undefined) {
    return failure(joinPath(path, 'type'), `${joinPath(path, 'type')} is required`);
  }

  const sessionValue = objectResult.value.session;
  if (sessionValue === undefined) {
    return failure(joinPath(path, 'session'), 'session is required');
  }

  const sessionResult = parseWatchSession(sessionValue, joinPath(path, 'session'));
  if (!sessionResult.ok) {
    return sessionResult;
  }

  return {
    ok: true,
    message: {
      type: typeResult.value,
      session: sessionResult.value,
    },
  };
}

function parseWatchSession(value: unknown, path: string): ValidationResult<WatchSession> {
  const objectResult = expectRecord(value, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const keyResult = expectAllowedKeys(objectResult.value, sessionKeys, path);
  if (!keyResult.ok) {
    return keyResult;
  }

  const localSessionId = readString(objectResult.value, 'localSessionId', path, { required: true });
  if (!localSessionId.ok) {
    return localSessionId;
  }
  if (localSessionId.value === undefined) {
    return failure(joinPath(path, 'localSessionId'), `${joinPath(path, 'localSessionId')} is required`);
  }

  const startedAt = readNumber(objectResult.value, 'startedAt', path, { required: true });
  if (!startedAt.ok) {
    return startedAt;
  }
  if (startedAt.value === undefined) {
    return failure(joinPath(path, 'startedAt'), `${joinPath(path, 'startedAt')} is required`);
  }

  const samples = readArray(objectResult.value, 'samples', path, parseWatchDepthSample, { required: true });
  if (!samples.ok) {
    return samples;
  }
  if (samples.value === undefined) {
    return failure(joinPath(path, 'samples'), `${joinPath(path, 'samples')} is required`);
  }

  const session: WatchSession = {
    localSessionId: localSessionId.value,
    startedAt: startedAt.value,
    samples: samples.value,
  };

  const schemaVersion = readInteger(objectResult.value, 'schemaVersion', path, { min: 1 });
  if (!schemaVersion.ok) {
    return schemaVersion;
  }
  assignOptional(session, 'schemaVersion', schemaVersion.value);

  const diveMode = readEnum(objectResult.value, 'diveMode', diveModes, path);
  if (!diveMode.ok) {
    return diveMode;
  }
  assignOptional(session, 'diveMode', diveMode.value);

  for (const key of ['gasLabel', 'siteId', 'siteName', 'sourcePlanLocalId', 'planTitle', 'notes'] as const) {
    const result = readString(objectResult.value, key, path);
    if (!result.ok) {
      return result;
    }
    assignOptional(session, key, result.value);
  }

  for (const key of ['buddyIds', 'gearIds', 'tags'] as const) {
    const result = readStringArray(objectResult.value, key, path);
    if (!result.ok) {
      return result;
    }
    assignOptional(session, key, result.value);
  }

  for (const key of ['rating', 'perceivedExertion', 'visibilityRating'] as const) {
    const result = readInteger(objectResult.value, key, path, { min: 1, max: 5 });
    if (!result.ok) {
      return result;
    }
    assignOptional(session, key, result.value);
  }

  const waterCondition = readEnum(objectResult.value, 'waterCondition', waterConditions, path);
  if (!waterCondition.ok) {
    return waterCondition;
  }
  assignOptional(session, 'waterCondition', waterCondition.value);

  const syncStatus = readEnum(objectResult.value, 'syncStatus', syncStatuses, path);
  if (!syncStatus.ok) {
    return syncStatus;
  }
  assignOptional(session, 'syncStatus', syncStatus.value);

  for (const key of ['entryLocation', 'exitLocation'] as const) {
    const result = readObject(objectResult.value, key, path, parseWatchLocation);
    if (!result.ok) {
      return result;
    }
    assignOptional(session, key, result.value);
  }

  for (const key of ['endedAt', 'maxDepthMeters', 'averageDepthMeters', 'waterTemperatureCelsius'] as const) {
    const result = readNumber(objectResult.value, key, path);
    if (!result.ok) {
      return result;
    }
    assignOptional(session, key, result.value);
  }

  const freedive = readObject(objectResult.value, 'freedive', path, parseFreeDivePayload);
  if (!freedive.ok) {
    return freedive;
  }

  const scuba = readObject(objectResult.value, 'scuba', path, parseScubaPayload);
  if (!scuba.ok) {
    return scuba;
  }

  if (freedive.value !== undefined && scuba.value !== undefined) {
    return failure(joinPath(path, 'scuba'), `${joinPath(path, 'scuba')} is not allowed with ${joinPath(path, 'freedive')}`);
  }

  if (diveMode.value === 'freedive') {
    if (freedive.value === undefined) {
      return failure(joinPath(path, 'freedive'), `${joinPath(path, 'freedive')} is required for freedive sessions`);
    }
    if (scuba.value !== undefined) {
      return failure(joinPath(path, 'scuba'), `${joinPath(path, 'scuba')} is not allowed for freedive sessions`);
    }
    session.freedive = freedive.value;
  } else if (diveMode.value === 'scuba') {
    if (scuba.value === undefined) {
      return failure(joinPath(path, 'scuba'), `${joinPath(path, 'scuba')} is required for scuba sessions`);
    }
    if (freedive.value !== undefined) {
      return failure(joinPath(path, 'freedive'), `${joinPath(path, 'freedive')} is not allowed for scuba sessions`);
    }
    session.scuba = scuba.value;
  } else if (freedive.value !== undefined || scuba.value !== undefined) {
    return failure(joinPath(path, 'diveMode'), `${joinPath(path, 'diveMode')} is required for nested mode payloads`);
  }

  return { ok: true, value: session };
}

function parseFreeDivePayload(value: unknown, path: string): ValidationResult<FreeDivePayload> {
  const objectResult = expectRecord(value, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const keyResult = expectAllowedKeys(objectResult.value, freeDiveKeys, path);
  if (!keyResult.ok) {
    return keyResult;
  }

  const diveCount = readInteger(objectResult.value, 'diveCount', path, { required: true, min: 0 });
  if (!diveCount.ok) {
    return diveCount;
  }
  if (diveCount.value === undefined) {
    return failure(joinPath(path, 'diveCount'), `${joinPath(path, 'diveCount')} is required`);
  }

  const maxDepthMeters = readNumber(objectResult.value, 'maxDepthMeters', path, { required: true, min: 0 });
  if (!maxDepthMeters.ok) {
    return maxDepthMeters;
  }
  if (maxDepthMeters.value === undefined) {
    return failure(joinPath(path, 'maxDepthMeters'), `${joinPath(path, 'maxDepthMeters')} is required`);
  }

  const longestDiveDurationSeconds = readNumber(objectResult.value, 'longestDiveDurationSeconds', path, {
    required: true,
    min: 0,
  });
  if (!longestDiveDurationSeconds.ok) {
    return longestDiveDurationSeconds;
  }
  if (longestDiveDurationSeconds.value === undefined) {
    return failure(
      joinPath(path, 'longestDiveDurationSeconds'),
      `${joinPath(path, 'longestDiveDurationSeconds')} is required`,
    );
  }

  const segments = readArray(objectResult.value, 'segments', path, parseFreeDiveSegment, { required: true });
  if (!segments.ok) {
    return segments;
  }
  if (segments.value === undefined) {
    return failure(joinPath(path, 'segments'), `${joinPath(path, 'segments')} is required`);
  }

  return {
    ok: true,
    value: {
      diveCount: diveCount.value,
      maxDepthMeters: maxDepthMeters.value,
      longestDiveDurationSeconds: longestDiveDurationSeconds.value,
      segments: segments.value,
    },
  };
}

function parseFreeDiveSegment(value: unknown, path: string): ValidationResult<FreeDiveSegment> {
  const objectResult = expectRecord(value, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const keyResult = expectAllowedKeys(objectResult.value, freeDiveSegmentKeys, path);
  if (!keyResult.ok) {
    return keyResult;
  }

  const segmentId = readString(objectResult.value, 'segmentId', path, { required: true });
  if (!segmentId.ok) {
    return segmentId;
  }
  if (segmentId.value === undefined) {
    return failure(joinPath(path, 'segmentId'), `${joinPath(path, 'segmentId')} is required`);
  }

  const index = readInteger(objectResult.value, 'index', path, { required: true, min: 1 });
  if (!index.ok) {
    return index;
  }
  if (index.value === undefined) {
    return failure(joinPath(path, 'index'), `${joinPath(path, 'index')} is required`);
  }

  const segment: FreeDiveSegment = {
    segmentId: segmentId.value,
    index: index.value,
    startedAt: 0,
    endedAt: 0,
    durationSeconds: 0,
    maxDepthMeters: 0,
    minDepthMeters: 0,
    sampleStartIndex: 0,
    sampleEndIndex: 0,
  };

  for (const key of ['startedAt', 'endedAt'] as const) {
    const result = readNumber(objectResult.value, key, path, { required: true });
    if (!result.ok) {
      return result;
    }
    if (result.value === undefined) {
      return failure(joinPath(path, key), `${joinPath(path, key)} is required`);
    }
    segment[key] = result.value;
  }

  for (const key of ['durationSeconds', 'maxDepthMeters', 'minDepthMeters'] as const) {
    const result = readNumber(objectResult.value, key, path, { required: true, min: 0 });
    if (!result.ok) {
      return result;
    }
    if (result.value === undefined) {
      return failure(joinPath(path, key), `${joinPath(path, key)} is required`);
    }
    segment[key] = result.value;
  }

  for (const key of ['sampleStartIndex', 'sampleEndIndex'] as const) {
    const result = readInteger(objectResult.value, key, path, { required: true, min: 0 });
    if (!result.ok) {
      return result;
    }
    if (result.value === undefined) {
      return failure(joinPath(path, key), `${joinPath(path, key)} is required`);
    }
    segment[key] = result.value;
  }

  for (const key of ['descentRateMetersPerSecond', 'ascentRateMetersPerSecond'] as const) {
    const result = readNumber(objectResult.value, key, path);
    if (!result.ok) {
      return result;
    }
    assignOptional(segment, key, result.value);
  }

  return { ok: true, value: segment };
}

function parseScubaPayload(value: unknown, path: string): ValidationResult<ScubaPayload> {
  const objectResult = expectRecord(value, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const keyResult = expectAllowedKeys(objectResult.value, scubaKeys, path);
  if (!keyResult.ok) {
    return keyResult;
  }

  const scuba: ScubaPayload = {
    maxDepthMeters: 0,
    averageDepthMeters: 0,
    latestAscentRateMetersPerMinute: 0,
    maxAscentRateMetersPerMinute: 0,
    safetyStop: {
      status: 'unknown',
      required: false,
      completed: false,
      targetDepthMeters: 0,
      minDepthMeters: 0,
      maxDepthMeters: 0,
      durationSeconds: 0,
      remainingSeconds: 0,
      timeInZoneSeconds: 0,
    },
  };

  const gasLabel = readString(objectResult.value, 'gasLabel', path);
  if (!gasLabel.ok) {
    return gasLabel;
  }
  assignOptional(scuba, 'gasLabel', gasLabel.value);

  for (const key of ['maxDepthMeters', 'averageDepthMeters'] as const) {
    const result = readNumber(objectResult.value, key, path, { required: true, min: 0 });
    if (!result.ok) {
      return result;
    }
    if (result.value === undefined) {
      return failure(joinPath(path, key), `${joinPath(path, key)} is required`);
    }
    scuba[key] = result.value;
  }

  const waterTemperatureCelsius = readNumber(objectResult.value, 'waterTemperatureCelsius', path);
  if (!waterTemperatureCelsius.ok) {
    return waterTemperatureCelsius;
  }
  assignOptional(scuba, 'waterTemperatureCelsius', waterTemperatureCelsius.value);

  for (const key of ['latestAscentRateMetersPerMinute', 'maxAscentRateMetersPerMinute'] as const) {
    const result = readNumber(objectResult.value, key, path, { required: true, min: 0 });
    if (!result.ok) {
      return result;
    }
    if (result.value === undefined) {
      return failure(joinPath(path, key), `${joinPath(path, key)} is required`);
    }
    scuba[key] = result.value;
  }

  const safetyStop = readObject(objectResult.value, 'safetyStop', path, parseSafetyStopRecord);
  if (!safetyStop.ok) {
    return safetyStop;
  }
  if (safetyStop.value === undefined) {
    return failure(joinPath(path, 'safetyStop'), `${joinPath(path, 'safetyStop')} is required`);
  }
  scuba.safetyStop = safetyStop.value;

  return { ok: true, value: scuba };
}

function parseSafetyStopRecord(value: unknown, path: string): ValidationResult<SafetyStopRecord> {
  const objectResult = expectRecord(value, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const keyResult = expectAllowedKeys(objectResult.value, safetyStopKeys, path);
  if (!keyResult.ok) {
    return keyResult;
  }

  const status = readEnum(objectResult.value, 'status', safetyStopStatuses, path, { required: true });
  if (!status.ok) {
    return status;
  }
  if (status.value === undefined) {
    return failure(joinPath(path, 'status'), `${joinPath(path, 'status')} is required`);
  }

  const required = readBoolean(objectResult.value, 'required', path, { required: true });
  if (!required.ok) {
    return required;
  }
  if (required.value === undefined) {
    return failure(joinPath(path, 'required'), `${joinPath(path, 'required')} is required`);
  }

  const completed = readBoolean(objectResult.value, 'completed', path, { required: true });
  if (!completed.ok) {
    return completed;
  }
  if (completed.value === undefined) {
    return failure(joinPath(path, 'completed'), `${joinPath(path, 'completed')} is required`);
  }

  const safetyStop: SafetyStopRecord = {
    status: status.value,
    required: required.value,
    completed: completed.value,
    targetDepthMeters: 0,
    minDepthMeters: 0,
    maxDepthMeters: 0,
    durationSeconds: 0,
    remainingSeconds: 0,
    timeInZoneSeconds: 0,
  };

  for (const key of ['targetDepthMeters', 'minDepthMeters', 'maxDepthMeters'] as const) {
    const result = readNumber(objectResult.value, key, path, { required: true });
    if (!result.ok) {
      return result;
    }
    if (result.value === undefined) {
      return failure(joinPath(path, key), `${joinPath(path, key)} is required`);
    }
    safetyStop[key] = result.value;
  }

  for (const key of ['durationSeconds', 'remainingSeconds', 'timeInZoneSeconds'] as const) {
    const result = readNumber(objectResult.value, key, path, { required: true, min: 0 });
    if (!result.ok) {
      return result;
    }
    if (result.value === undefined) {
      return failure(joinPath(path, key), `${joinPath(path, key)} is required`);
    }
    safetyStop[key] = result.value;
  }

  for (const key of ['startedAt', 'completedAt'] as const) {
    const result = readNumber(objectResult.value, key, path);
    if (!result.ok) {
      return result;
    }
    assignOptional(safetyStop, key, result.value);
  }

  return { ok: true, value: safetyStop };
}

function parseWatchLocation(value: unknown, path: string): ValidationResult<WatchLocation> {
  const objectResult = expectRecord(value, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const keyResult = expectAllowedKeys(objectResult.value, locationKeys, path);
  if (!keyResult.ok) {
    return keyResult;
  }

  const latitude = readNumber(objectResult.value, 'latitude', path, { required: true });
  if (!latitude.ok) {
    return latitude;
  }
  if (latitude.value === undefined) {
    return failure(joinPath(path, 'latitude'), `${joinPath(path, 'latitude')} is required`);
  }

  const longitude = readNumber(objectResult.value, 'longitude', path, { required: true });
  if (!longitude.ok) {
    return longitude;
  }
  if (longitude.value === undefined) {
    return failure(joinPath(path, 'longitude'), `${joinPath(path, 'longitude')} is required`);
  }

  const location: WatchLocation = {
    latitude: latitude.value,
    longitude: longitude.value,
  };

  const horizontalAccuracyMeters = readNumber(objectResult.value, 'horizontalAccuracyMeters', path);
  if (!horizontalAccuracyMeters.ok) {
    return horizontalAccuracyMeters;
  }
  assignOptional(location, 'horizontalAccuracyMeters', horizontalAccuracyMeters.value);

  const capturedAt = readNumber(objectResult.value, 'capturedAt', path);
  if (!capturedAt.ok) {
    return capturedAt;
  }
  assignOptional(location, 'capturedAt', capturedAt.value);

  return { ok: true, value: location };
}

function parseWatchDepthSample(value: unknown, path: string): ValidationResult<WatchDepthSample> {
  const objectResult = expectRecord(value, path);
  if (!objectResult.ok) {
    return objectResult;
  }

  const keyResult = expectAllowedKeys(objectResult.value, sampleKeys, path);
  if (!keyResult.ok) {
    return keyResult;
  }

  const localSessionId = readString(objectResult.value, 'localSessionId', path, { required: true });
  if (!localSessionId.ok) {
    return localSessionId;
  }
  if (localSessionId.value === undefined) {
    return failure(joinPath(path, 'localSessionId'), `${joinPath(path, 'localSessionId')} is required`);
  }

  const timestamp = readNumber(objectResult.value, 'timestamp', path, { required: true });
  if (!timestamp.ok) {
    return timestamp;
  }
  if (timestamp.value === undefined) {
    return failure(joinPath(path, 'timestamp'), `${joinPath(path, 'timestamp')} is required`);
  }

  const depthMeters = readNumber(objectResult.value, 'depthMeters', path, { required: true });
  if (!depthMeters.ok) {
    return depthMeters;
  }
  if (depthMeters.value === undefined) {
    return failure(joinPath(path, 'depthMeters'), `${joinPath(path, 'depthMeters')} is required`);
  }

  const sample: WatchDepthSample = {
    localSessionId: localSessionId.value,
    timestamp: timestamp.value,
    depthMeters: depthMeters.value,
  };

  const pressureKPa = readNumber(objectResult.value, 'pressureKPa', path);
  if (!pressureKPa.ok) {
    return pressureKPa;
  }
  assignOptional(sample, 'pressureKPa', pressureKPa.value);

  const waterTemperatureCelsius = readNumber(objectResult.value, 'waterTemperatureCelsius', path);
  if (!waterTemperatureCelsius.ok) {
    return waterTemperatureCelsius;
  }
  assignOptional(sample, 'waterTemperatureCelsius', waterTemperatureCelsius.value);

  return { ok: true, value: sample };
}

type RecordValue = Record<string, unknown>;
type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: WatchSyncMessageValidationError };

function expectRecord(value: unknown, path: string): ValidationResult<RecordValue> {
  if (!isRecord(value)) {
    return failure(path, `${path} must be an object`);
  }

  return { ok: true, value };
}

function expectAllowedKeys(object: RecordValue, allowedKeys: readonly string[], path: string): ValidationResult<void> {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(object).find(key => !allowed.has(key));

  if (unknownKey) {
    const unknownPath = joinPath(path, unknownKey);
    return failure(unknownPath, `${unknownPath} is not allowed`);
  }

  return { ok: true, value: undefined };
}

function readString<Key extends string>(
  object: RecordValue,
  key: Key,
  path: string,
  options: { required?: boolean } = {},
): ValidationResult<string | undefined> {
  return readPrimitive(object, key, path, isString, 'string', options.required);
}

function readNumber<Key extends string>(
  object: RecordValue,
  key: Key,
  path: string,
  options: { required?: boolean; min?: number; max?: number } = {},
): ValidationResult<number | undefined> {
  const result = readPrimitive(object, key, path, isFiniteNumber, 'number', options.required);
  if (!result.ok || result.value === undefined) {
    return result;
  }

  const valuePath = joinPath(path, key);
  if (options.min !== undefined && result.value < options.min) {
    return failure(valuePath, `${valuePath} must be >= ${options.min}`);
  }
  if (options.max !== undefined && result.value > options.max) {
    return failure(valuePath, `${valuePath} must be <= ${options.max}`);
  }

  return result;
}

function readInteger<Key extends string>(
  object: RecordValue,
  key: Key,
  path: string,
  options: { required?: boolean; min?: number; max?: number } = {},
): ValidationResult<number | undefined> {
  const result = readPrimitive(object, key, path, isIntegerNumber, 'integer', options.required);
  if (!result.ok || result.value === undefined) {
    return result;
  }

  const valuePath = joinPath(path, key);
  if (options.min !== undefined && result.value < options.min) {
    return failure(valuePath, `${valuePath} must be >= ${options.min}`);
  }
  if (options.max !== undefined && result.value > options.max) {
    return failure(valuePath, `${valuePath} must be <= ${options.max}`);
  }

  return result;
}

function readEnum<Key extends string, Value extends string>(
  object: RecordValue,
  key: Key,
  allowedValues: readonly Value[],
  path: string,
  options: { required?: boolean } = {},
): ValidationResult<Value | undefined> {
  const result = readString(object, key, path, options);
  if (!result.ok || result.value === undefined) {
    return result as ValidationResult<Value | undefined>;
  }

  if (!allowedValues.includes(result.value as Value)) {
    const valuePath = joinPath(path, key);
    return failure(valuePath, `${valuePath} must be one of ${allowedValues.join(', ')}`);
  }

  return { ok: true, value: result.value as Value };
}

function readStringArray<Key extends string>(
  object: RecordValue,
  key: Key,
  path: string,
): ValidationResult<string[] | undefined> {
  return readArray(object, key, path, (value, itemPath) => {
    if (!isString(value)) {
      return failure(itemPath, `${itemPath} must be a string`);
    }
    return { ok: true, value };
  });
}

function readBoolean<Key extends string>(
  object: RecordValue,
  key: Key,
  path: string,
  options: { required?: boolean } = {},
): ValidationResult<boolean | undefined> {
  return readPrimitive(object, key, path, isBoolean, 'boolean', options.required);
}

function readObject<Key extends string, T>(
  object: RecordValue,
  key: Key,
  path: string,
  parser: (value: unknown, path: string) => ValidationResult<T>,
): ValidationResult<T | undefined> {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    return { ok: true, value: undefined };
  }

  return parser(object[key], joinPath(path, key));
}

function readArray<Key extends string, T>(
  object: RecordValue,
  key: Key,
  path: string,
  parser: (value: unknown, path: string) => ValidationResult<T>,
  options: { required?: boolean } = {},
): ValidationResult<T[] | undefined> {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    if (options.required) {
      const valuePath = joinPath(path, key);
      return failure(valuePath, `${valuePath} is required`);
    }
    return { ok: true, value: undefined };
  }

  const value = object[key];
  const valuePath = joinPath(path, key);
  if (!Array.isArray(value)) {
    return failure(valuePath, `${valuePath} must be an array`);
  }

  const items: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const itemResult = parser(value[index], `${valuePath}[${index}]`);
    if (!itemResult.ok) {
      return itemResult;
    }
    items.push(itemResult.value);
  }

  return { ok: true, value: items };
}

function readPrimitive<Key extends string, T>(
  object: RecordValue,
  key: Key,
  path: string,
  predicate: (value: unknown) => value is T,
  typeName: string,
  required = false,
): ValidationResult<T | undefined> {
  const valuePath = joinPath(path, key);
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    if (required) {
      return failure(valuePath, `${valuePath} is required`);
    }
    return { ok: true, value: undefined };
  }

  const value = object[key];
  if (!predicate(value)) {
    return failure(valuePath, `${valuePath} must be a ${typeName}`);
  }

  return { ok: true, value };
}

function assignOptional<T extends object, Key extends keyof T>(target: T, key: Key, value: T[Key] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function failure(path: string, message: string): { ok: false; error: WatchSyncMessageValidationError } {
  return {
    ok: false,
    error: {
      path,
      message,
    },
  };
}

function joinPath(path: string, key: string): string {
  return path === '$' ? key : `${path}.${key}`;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
