import {
  createAccountClaimSheetOptions,
  resolveAccountClaimAutoRoute,
  resolveHomeClaimRecoveryVisibility,
} from '../src/components/navigation';

describe('account claim automatic navigation', () => {
  test('uses the native form sheet presentation', () => {
    expect(createAccountClaimSheetOptions('#f5f5f7')).toEqual({
      presentation: 'formSheet',
      sheetAllowedDetents: expect.anything(),
      sheetGrabberVisible: true,
      sheetCornerRadius: 28,
      contentStyle: { backgroundColor: '#f5f5f7' },
    });
  });

  test.each(['authLogin', 'authOnboarding'] as const)(
    'replaces %s with the claim sheet for an online authenticated user',
    currentRoute => {
      expect(
        resolveAccountClaimAutoRoute({
          authStatus: 'authenticated',
          userId: 'user-1',
          isOnline: true,
          eligibleCount: 32,
          claimStatus: 'choice',
          currentRoute,
        }),
      ).toEqual({ action: 'replace', route: 'accountClaim', userId: 'user-1' });
    },
  );

  test('opens the claim sheet from tabs after restored login', () => {
    expect(
      resolveAccountClaimAutoRoute({
        authStatus: 'authenticated',
        userId: 'user-1',
        isOnline: true,
        eligibleCount: 32,
        claimStatus: 'choice',
        currentRoute: 'tabs',
      }),
    ).toEqual({ action: 'navigate', route: 'accountClaim', userId: 'user-1' });
  });

  test.each([
    ['zero eligible rows', 0, undefined, 'tabs'],
    ['the current sheet', 32, undefined, 'accountClaim'],
    ['a duplicate user route', 32, 'user-1', 'tabs'],
  ] as const)(
    'does not duplicate navigation for %s',
    (_label, eligibleCount, lastRoutedUserId, currentRoute) => {
      expect(
        resolveAccountClaimAutoRoute({
          authStatus: 'authenticated',
          userId: 'user-1',
          isOnline: true,
          eligibleCount,
          claimStatus: 'choice',
          currentRoute,
          lastRoutedUserId,
        }),
      ).toBeUndefined();
    },
  );

  test('does not route an offline account', () => {
    expect(
      resolveAccountClaimAutoRoute({
        authStatus: 'authenticatedOffline',
        userId: 'user-1',
        isOnline: false,
        eligibleCount: 32,
        claimStatus: 'choice',
        currentRoute: 'tabs',
      }),
    ).toBeUndefined();
  });

  test('does not automatically route a deferred manual choice', () => {
    expect(
      resolveAccountClaimAutoRoute({
        authStatus: 'authenticated',
        userId: 'user-1',
        isOnline: true,
        eligibleCount: 32,
        claimStatus: 'deferred',
        currentRoute: 'tabs',
      }),
    ).toBeUndefined();
  });

  test.each(['retained', 'complete'] as const)(
    'does not automatically route a %s terminal result',
    claimStatus => {
      expect(
        resolveAccountClaimAutoRoute({
          authStatus: 'authenticated',
          userId: 'user-1',
          isOnline: true,
          eligibleCount: 1,
          claimStatus,
          currentRoute: 'tabs',
        }),
      ).toBeUndefined();
    },
  );
});

describe('Home claim recovery visibility', () => {
  test.each([
    [false, 'failed', 0],
    [true, 'failed', 1],
    [false, 'deferred', 0],
    [true, 'deferred', 1],
  ] as const)(
    'returns %s for %s recovery with %i eligible rows',
    (expected, status, eligibleCount) => {
      expect(
        resolveHomeClaimRecoveryVisibility({status, eligibleCount}),
      ).toBe(expected);
    },
  );
});
