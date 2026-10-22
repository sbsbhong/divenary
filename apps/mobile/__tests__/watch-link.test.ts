import { createNativeWatchLink, type NativeWatchLinkModule } from '../src/companion/native-watch-link';
import {
  createUnavailableWatchLink,
  WatchSessionDeletionBridgeError,
  type WatchSessionDeletionCommand,
} from '../src/companion/watch-link';
import type { DivePlan } from '../src/types/dive-plan';

const command: WatchSessionDeletionCommand = {
  formatVersion: 1,
  commandId: 'a'.repeat(64),
  localSessionId: 'watch-session-1',
  requestedAt: 100,
  contentRevision: 'revision-1',
  artifactSha256: 'b'.repeat(64),
};

const basePlan = (overrides: Partial<DivePlan>): DivePlan => ({
  localId: 'plan',
  status: 'draft',
  createdAt: 100,
  updatedAt: 100,
  site: {},
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: {},
  checklistItems: [],
  ...overrides,
});

function nativeModule(overrides: Partial<NativeWatchLinkModule> = {}): NativeWatchLinkModule {
  return {
    drainPendingPayloads: jest.fn(async () => []),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    ...overrides,
  };
}

describe('watch link', () => {
  it('queues an exact validated deletion command through the native module', async () => {
    const queueSessionDeletion = jest.fn().mockResolvedValue(undefined);
    const link = createNativeWatchLink(nativeModule({ queueSessionDeletion }));

    await link.queueSessionDeletion(command);

    expect(queueSessionDeletion).toHaveBeenCalledWith(command);
  });

  it('rejects malformed deletion commands before calling native', async () => {
    const queueSessionDeletion = jest.fn().mockResolvedValue(undefined);
    const link = createNativeWatchLink(nativeModule({ queueSessionDeletion }));

    await expect(link.queueSessionDeletion({ ...command, commandId: 'invalid' })).rejects.toBeInstanceOf(
      WatchSessionDeletionBridgeError,
    );
    expect(queueSessionDeletion).not.toHaveBeenCalled();
  });

  it('validates and sorts acknowledgement receipts', async () => {
    const link = createNativeWatchLink(
      nativeModule({
        listSessionDeletionAcknowledgements: async () => [
          {
            formatVersion: 1,
            commandId: 'c'.repeat(64),
            localSessionId: 'watch-session-2',
            acknowledgedAt: 200,
            result: 'alreadyAbsent',
          },
          {
            formatVersion: 1,
            commandId: 'a'.repeat(64),
            localSessionId: 'watch-session-1',
            acknowledgedAt: 100,
            result: 'deleted',
            removedContentRevision: 'revision-1',
            removedArtifactSha256: 'b'.repeat(64),
          },
        ],
      }),
    );

    const receipts = await link.listSessionDeletionAcknowledgements();

    expect(receipts.map(receipt => receipt.localSessionId)).toEqual(['watch-session-1', 'watch-session-2']);
  });

  it('fails closed on malformed acknowledgement data', async () => {
    const link = createNativeWatchLink(
      nativeModule({
        listSessionDeletionAcknowledgements: async () => [
          {
            formatVersion: 1,
            commandId: 'a'.repeat(64),
            localSessionId: 'watch-session-1',
            acknowledgedAt: 100,
            result: 'unknown',
          },
        ],
      }),
    );

    await expect(link.listSessionDeletionAcknowledgements()).rejects.toBeInstanceOf(
      WatchSessionDeletionBridgeError,
    );
  });

  it('sends only unexecuted planned dives to the watch and keeps drafts on the iPhone', async () => {
    const updatePlannedDives = jest.fn().mockResolvedValue({
      nativeBridgeAvailable: true,
      isSupported: true,
      activationState: 'activated',
      isPaired: true,
      isWatchAppInstalled: true,
      isReachable: false,
      payloadCount: 1,
      queuedCount: 1,
    });
    const link = createNativeWatchLink(nativeModule({ updatePlannedDives }));

    const status = await link.updatePlannedDives([
      basePlan({ localId: 'draft-plan', status: 'draft', title: 'Draft plan' }),
      basePlan({ localId: 'planned-plan', status: 'planned', title: 'Planned plan' }),
      basePlan({ localId: 'completed-plan', status: 'completed', title: 'Completed plan' }),
      basePlan({ localId: 'converted-plan', status: 'planned', convertedLogLocalId: 'log-1' }),
    ]);

    const payload = JSON.parse(updatePlannedDives.mock.calls[0][0]) as Array<{ localId: string }>;
    expect(payload.map(plan => plan.localId)).toEqual(['planned-plan']);
    expect(status).toMatchObject({ nativeBridgeAvailable: true, activationState: 'activated', payloadCount: 1 });
  });

  it('falls back to a quiet unavailable link when the platform has no companion module', async () => {
    const link = createNativeWatchLink(undefined);
    const unavailable = createUnavailableWatchLink();

    expect(link.isAvailable()).toBe(false);
    await expect(link.drainPendingPayloads()).resolves.toEqual([]);
    await expect(link.getLinkedWatchInfo()).resolves.toEqual(await unavailable.getLinkedWatchInfo());
    await expect(link.updatePlannedDives([basePlan({ status: 'planned' })])).resolves.toMatchObject({
      activationState: 'unsupported',
      payloadCount: 1,
    });
  });
});

describe('watch link boundary', () => {
  it('keeps platform watch modules behind src/companion', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const root = path.join(__dirname, '../src');
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
          if (name !== 'companion') {
            visit(full);
          }
        } else if (/\.(ts|tsx)$/.test(name)) {
          const source = fs.readFileSync(full, 'utf8');
          if (/WatchConnectivityModule|WearableCompanionModule|DiveWatchSyncPayloadReceived/.test(source)) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    visit(root);

    expect(offenders).toEqual([]);
  });
});
