export type DataPrincipal =
  | { kind: 'guest' }
  | { kind: 'user'; userId: string };

export function principalScope(principal: DataPrincipal): string {
  return principal.kind === 'guest' ? 'guest' : `user:${principal.userId}`;
}

export function dataStorageKeys(principal: DataPrincipal) {
  const encoded = encodeURIComponent(principalScope(principal));

  return {
    logbook: `dive-app:data:${encoded}:logbook:v1`,
    planbook: `dive-app:data:${encoded}:planbook:v1`,
    outbox: `dive-app:data:${encoded}:outbox:v1`,
    claim: `dive-app:data:${encoded}:claim:v1`,
  } as const;
}

export function dataProfileKeyPrefix(principal: DataPrincipal): string {
  return `dive-mobile:watch-profile:${encodeURIComponent(principalScope(principal))}:`;
}
