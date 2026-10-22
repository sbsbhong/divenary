import { toWatchPlannedDivePayloads } from '../src/companion/watch-link';
import type { DivePlan } from '../src/types/dive-plan';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');

const repoRoot = path.join(__dirname, '../../..');
const readRepoFile = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readSchema = (name: string) =>
  JSON.parse(readRepoFile(`packages/contracts/schemas/${name}`)) as {
    definitions?: Record<string, { properties: Record<string, { const?: string }> }>;
    properties?: Record<string, unknown>;
    required?: string[];
  };

const linkSchema = readSchema('watch-link-messages.schema.json');
const plannedDiveSchema = readSchema('watch-planned-dive.schema.json');
/** Which side writes each message; the other side may ignore optional keys. */
const messageSenders = [
  ['WatchSyncFileMetadata', 'watch'],
  ['WatchSyncAcknowledgement', 'phone'],
  ['WatchPlannedDivesContext', 'phone'],
  ['WatchSessionDeletionCommand', 'phone'],
  ['WatchSessionDeletionAcknowledgement', 'watch'],
] as const;

describe('watch link contract', () => {
  const watchEnvelope = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Sync/WatchSyncEnvelope.swift');
  const phoneInbox = readRepoFile('apps/mobile/ios/Divenary/WatchConnectivityInbox.swift');

  it.each(messageSenders)('%s: the %s writes every schema key and both sides know its kind', (name, sender) => {
    const message = linkSchema.definitions![name]!;
    const senderSource = sender === 'watch' ? watchEnvelope : phoneInbox;

    for (const key of Object.keys(message.properties)) {
      expect(senderSource).toContain(`"${key}"`);
    }
    const kind = message.properties.kind?.const;
    expect(kind).toBeDefined();
    expect(watchEnvelope).toContain(`"${kind}"`);
    expect(phoneInbox).toContain(`"${kind}"`);
  });

  it('sends planned dives with only the keys the planned dive schema allows', () => {
    const plan: DivePlan = {
      localId: 'plan-1',
      status: 'planned',
      createdAt: 100,
      updatedAt: 100,
      title: 'Morning dive',
      site: { name: 'Moon Island' },
      buddyIds: ['buddy'],
      gearIds: ['gear'],
      tags: ['tag'],
      plannedAt: 200,
      plannedValues: { plannedMaxDepthMeters: 18, plannedDurationMinutes: 40 },
      checklistItems: [],
      diveMode: 'scuba',
    };

    const [payload] = toWatchPlannedDivePayloads([plan]);
    const allowed = Object.keys(plannedDiveSchema.properties!);

    expect(Object.keys(payload!).every(key => allowed.includes(key))).toBe(true);
    expect(plannedDiveSchema.required!.every(key => key in payload!)).toBe(true);
  });

  it('decodes every planned dive key on the watch', () => {
    const watchModel = readRepoFile('apps/mobile/ios/DivenaryWatchApp/Models/DiveSession.swift');
    const structBody = watchModel.slice(watchModel.indexOf('struct WatchPlannedDive:'));

    for (const key of Object.keys(plannedDiveSchema.properties!)) {
      expect(structBody).toMatch(new RegExp(`let ${key}:`));
    }
  });
});
