import {
  WatchSessionDeletionBridgeError,
  listWatchSessionDeletionAcknowledgements,
  queueWatchSessionDeletion,
  type WatchSessionDeletionCommand,
} from '../src/native/watch-connectivity';

describe('WatchConnectivity deletion bridge', () => {
  const command: WatchSessionDeletionCommand = {
    formatVersion: 1,
    commandId: 'a'.repeat(64),
    localSessionId: 'watch-session-1',
    requestedAt: 100,
    contentRevision: 'revision-1',
    artifactSha256: 'b'.repeat(64),
  };

  it('queues an exact validated deletion command', async () => {
    const queue = jest.fn().mockResolvedValue(undefined);

    await queueWatchSessionDeletion(command, queue);

    expect(queue).toHaveBeenCalledWith(command);
  });

  it('rejects malformed deletion commands before calling native', async () => {
    const queue = jest.fn().mockResolvedValue(undefined);

    await expect(
      queueWatchSessionDeletion({...command, commandId: 'invalid'}, queue),
    ).rejects.toBeInstanceOf(WatchSessionDeletionBridgeError);
    expect(queue).not.toHaveBeenCalled();
  });

  it('validates and sorts native acknowledgement receipts', async () => {
    const receipts = await listWatchSessionDeletionAcknowledgements(
      async () => [
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
    );

    expect(receipts.map(value => value.localSessionId)).toEqual([
      'watch-session-1',
      'watch-session-2',
    ]);
  });

  it('fails closed on malformed acknowledgement data', async () => {
    await expect(
      listWatchSessionDeletionAcknowledgements(async () => [
        {
          formatVersion: 1,
          commandId: 'a'.repeat(64),
          localSessionId: 'watch-session-1',
          acknowledgedAt: 100,
          result: 'unknown',
        },
      ]),
    ).rejects.toBeInstanceOf(WatchSessionDeletionBridgeError);
  });
});
