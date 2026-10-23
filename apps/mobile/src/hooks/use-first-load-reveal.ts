import React from 'react';
import { MOTION_TIMING } from '../constants/motion';

/**
 * True only on the render where a first-load skeleton hands over to content, so that content mounts
 * with its entering fade. A refetch, a first render with data already there, and every later render
 * return false. The flag holds for the fade time only, so content that mounts after the fade (for
 * example a row scrolled into view) does not fade.
 */
export function useFirstLoadReveal(isFirstLoad: boolean): boolean {
  const [wasFirstLoad, setWasFirstLoad] = React.useState(isFirstLoad);
  const [reveal, setReveal] = React.useState(false);

  // Set during render, so the content that mounts on this render already sees the flag.
  if (isFirstLoad !== wasFirstLoad) {
    setWasFirstLoad(isFirstLoad);
    setReveal(wasFirstLoad && !isFirstLoad);
  }

  React.useEffect(() => {
    if (!reveal) {
      return;
    }
    const timer = setTimeout(() => setReveal(false), MOTION_TIMING.fade);
    return () => clearTimeout(timer);
  }, [reveal]);

  return reveal;
}
