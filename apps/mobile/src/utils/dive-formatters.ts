import type { DivePressureValues } from '../types/dive-log-entry';

export const formatDate = (seconds?: number, locale = 'ko', unknownLabel = '--') => {
  if (!seconds) {
    return unknownLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(seconds * 1000));
};

export const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

export const formatDepth = (meters?: number) => {
  if (meters === undefined) {
    return '-- m';
  }

  return `${formatDecimal(meters)} m`;
};

export const formatLength = (meters?: number) => {
  if (meters === undefined) {
    return '-- m';
  }

  return `${formatDecimal(meters)} m`;
};

export const formatTemperature = (celsius?: number) => {
  if (celsius === undefined) {
    return '-- °C';
  }

  return `${formatDecimal(celsius)} °C`;
};

export const formatRating = (rating?: number, notRatedLabel = '평가 없음') => {
  if (!rating) {
    return notRatedLabel;
  }

  return '★'.repeat(Math.max(1, Math.min(5, rating)));
};

export const formatPressure = (pressure?: DivePressureValues) => {
  if (!pressure || (pressure.start === undefined && pressure.end === undefined)) {
    return undefined;
  }

  const unit = pressure.unit ?? 'bar';

  if (pressure.start !== undefined && pressure.end !== undefined) {
    return `${formatPressureNumber(pressure.start)} ${unit} -> ${formatPressureNumber(pressure.end)} ${unit}`;
  }

  if (pressure.start !== undefined) {
    return `${formatPressureNumber(pressure.start)} ${unit}`;
  }

  return `${formatPressureNumber(pressure.end!)} ${unit}`;
};

function formatDecimal(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function formatPressureNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${Math.round((value + Number.EPSILON) * 10) / 10}`;
}
