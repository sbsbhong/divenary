export type AccountDataCursor = {sortTime: string; id: string};
export type AccountDataPage<T> = {items: T[]; nextCursor?: AccountDataCursor};
export type RemoteDivePlan = {
  id: string;
  localId: string;
  revision: number;
  payloadSha256: string;
  payload: Record<string, unknown>;
};
export type RemoteDiveLog = {
  id: string;
  localId: string;
  revision: number;
  payloadSha256: string;
  payload: Record<string, unknown>;
  profilePath?: string;
};
export type AccountMutationResult<T> =
  | {status: 'saved'; value: T}
  | {status: 'conflict'; remote: T};

export type AccountDataRepository = {
  listLogs(input?: {cursor?: AccountDataCursor; limit?: number}): Promise<AccountDataPage<RemoteDiveLog>>;
  listPlans(input?: {cursor?: AccountDataCursor; limit?: number}): Promise<AccountDataPage<RemoteDivePlan>>;
  saveLog(value: RemoteDiveLog, expectedRevision?: number): Promise<AccountMutationResult<RemoteDiveLog>>;
  savePlan(value: RemoteDivePlan, expectedRevision?: number): Promise<AccountMutationResult<RemoteDivePlan>>;
  deleteLog(id: string, expectedRevision: number): Promise<AccountMutationResult<RemoteDiveLog>>;
  deletePlan(id: string, expectedRevision: number): Promise<AccountMutationResult<RemoteDivePlan>>;
};

export type GuestClaimBatchInput = {
  clientBatchId: string;
  manifestSha256: string;
  expectedPlanCount: number;
  expectedLogCount: number;
};

export type GuestClaimStageInput = {
  batchId: string;
  entityKind: 'plan' | 'log';
  clientRecordId: string;
  payloadSha256: string;
  payload: Record<string, unknown>;
  sourcePlanClientRecordId?: string;
  convertedLogClientRecordId?: string;
};

export type GuestClaimRemoteRepository = {
  createOrLoadBatch(input: GuestClaimBatchInput): Promise<{id: string; status: 'uploading' | 'committed' | 'abandoned'}>;
  stageRecord(input: GuestClaimStageInput): Promise<{stagingRecordId: string; targetRecordId: string}>;
  attachProfile(input: {stagingRecordId: string; path: string; contentRevision: string; sha256: string; byteCount: number; sampleCount: number}): Promise<void>;
  uploadProfile(path: string, bytes: Uint8Array): Promise<void>;
  downloadProfile(path: string): Promise<Uint8Array>;
  finalize(batchId: string): Promise<{status: 'committed'; planCount: number; logCount: number}>;
  abandon(batchId: string): Promise<{
    status: 'abandoned' | 'committed';
    storageCleanupPending: boolean;
  }>;
  listCommittedBatch(batchId: string): Promise<{plans: RemoteDivePlan[]; logs: RemoteDiveLog[]}>;
};

export type VerifiedCurrentUser = {userId: string};
