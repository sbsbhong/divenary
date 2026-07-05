import type { MobileDiveSession, WatchSyncMessage } from '../types/dive-session';
import { getSessionImportKey } from './session-summary';

export const importWatchMessages = (
  existingSessions: MobileDiveSession[],
  messages: WatchSyncMessage[],
): MobileDiveSession[] => {
  const sessionsByKey = new Map(existingSessions.map(session => [session.importKey, session]));
  const importedAt = Date.now() / 1000;

  for (const message of messages) {
    const importKey = getSessionImportKey(message.session);
    const currentSession = sessionsByKey.get(importKey);

    sessionsByKey.set(importKey, {
      ...currentSession,
      ...message.session,
      importKey,
      importedAt: currentSession?.importedAt ?? importedAt,
      mediaPlaceholders: currentSession?.mediaPlaceholders ?? ['Photo import placeholder'],
      syncStatus: 'synced',
    });
  }

  return Array.from(sessionsByKey.values()).sort((left, right) => right.startedAt - left.startedAt);
};
