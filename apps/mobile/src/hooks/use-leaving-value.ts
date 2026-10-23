import React from 'react';

/**
 * Holds the value that was just replaced or cleared, for `durationMs`, so it can fade out while the
 * new value arrives. Returns undefined when nothing is leaving.
 */
export function useLeavingValue<T>(value: T | undefined, durationMs: number): T | undefined {
  const [shown, setShown] = React.useState(value);
  const [leaving, setLeaving] = React.useState<T | undefined>(undefined);

  // Set during render, so the leaving copy renders in the same commit as the new value.
  if (value !== shown) {
    setShown(value);
    if (shown !== undefined) {
      setLeaving(shown);
    }
  }

  React.useEffect(() => {
    if (leaving === undefined) {
      return;
    }
    const timer = setTimeout(() => setLeaving(undefined), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, leaving]);

  return leaving;
}
