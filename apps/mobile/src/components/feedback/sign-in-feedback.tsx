import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, type AuthState } from '../../states/auth';
import { useAppFeedback } from './app-feedback';

// Statuses the diver passes through while signing in. Reaching `authenticated` from one of them is
// a sign-in; reaching it from `bootstrapping` is a restored session, and `authenticatedOffline` is
// a connectivity change, so neither is announced.
const SIGN_IN_STATUSES: ReadonlySet<AuthState['status']> = new Set(['authenticating', 'pendingOnboarding']);

/**
 * Says "Signed in" once when a sign-in finishes. Signing in changes the data owner, which swaps
 * the whole navigation for the start shell, so no sheet ever "closes" to report it. This sits
 * above the account-data gate and watches Auth instead.
 */
export function SignInFeedback(): null {
  const { state } = useAuth();
  const { notify } = useAppFeedback();
  const { t } = useTranslation();
  const previousStatus = React.useRef(state.status);

  React.useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = state.status;
    if (state.status === 'authenticated' && SIGN_IN_STATUSES.has(previous)) {
      notify(t('feedback.signedIn'), 'success');
    }
  }, [notify, state.status, t]);

  return null;
}
