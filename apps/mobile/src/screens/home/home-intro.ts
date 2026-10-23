// Module state on purpose: the intro belongs to the JS runtime, so returning to Home from another tab
// (or any later mount in this run) never plays it again.
let introPlayed = false;

export function hasHomeIntroPlayed(): boolean {
  return introPlayed;
}

export function markHomeIntroPlayed(): void {
  introPlayed = true;
}
