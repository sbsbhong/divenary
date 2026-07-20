import {
  ACCOUNT_CLAIM_SHEET_OPTIONS,
  resolveAccountClaimAutoRoute,
} from '../src/components/navigation';

describe('account claim automatic navigation', () => {
  test('uses the native form sheet presentation', () => {
    expect(ACCOUNT_CLAIM_SHEET_OPTIONS).toEqual({
      presentation: 'formSheet',
      sheetAllowedDetents: expect.anything(),
      sheetGrabberVisible: true,
      sheetCornerRadius: 28,
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
});
