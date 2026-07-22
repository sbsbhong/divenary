export type GuestClaimItem = {
  key: string;
  entityKind: 'plan' | 'log';
  clientRecordId: string;
  payloadSha256: string;
  sourcePlanClientRecordId?: string;
  convertedLogClientRecordId?: string;
  profile?: {
    storageKey: string;
    contentRevision: string;
    sha256: string;
    sampleCount: number;
  };
  stagingRecordId?: string;
  targetRecordId?: string;
  completedAt?: number;
};

export type GuestClaimManifest = {
  schemaVersion: 1;
  userId: string;
  clientBatchId: string;
  remoteBatchId?: string;
  manifestSha256: string;
  status:
    | 'prepared'
    | 'running'
    | 'finalizing'
    | 'committed'
    | 'cleanupPending'
    | 'deferred'
    | 'failed';
  planCount: number;
  logCount: number;
  items: GuestClaimItem[];
  createdAt: number;
  updatedAt: number;
};

export type GuestClaimProgress = {
  completed: number;
  total: number;
  currentLabel?: string;
  phase: 'uploading' | 'finalizing' | 'cleanup';
};

export type GuestClaimErrorCode =
  | 'network_unavailable'
  | 'session_expired'
  | 'profile_missing'
  | 'profile_corrupt'
  | 'relationship_invalid'
  | 'remote_conflict'
  | 'claim_validation_failed';

export type GuestClaimFailureDetail = {
  phase: 'checking' | 'uploading' | 'finalizing' | 'cleanup';
  entityKind?: GuestClaimItem['entityKind'];
  clientRecordId?: string;
  label?: string;
};

export type GuestClaimViewState =
  | { status: 'hidden' }
  | { status: 'choice'; logCount: number; planCount: number }
  | { status: 'deferred'; logCount: number; planCount: number }
  | {
      status: 'running';
      completed: number;
      total: number;
      currentLabel?: string;
      phase?: GuestClaimProgress['phase'];
    }
  | {
      status: 'failed';
      completed: number;
      total: number;
      errorCode: GuestClaimErrorCode;
      failure?: GuestClaimFailureDetail;
    }
  | { status: 'complete'; imported: number };
