import React from 'react';
import { defaultWatchLink } from '../companion/default-watch-link';
import { isWatchVisiblePlan, type PlannedWatchDivesUpdateStatus } from '../companion/watch-link';
import type { DivePlan } from '../types/dive-plan';
import type { DivePlanRepository } from '../repositories/dive-plan-repository';
import { defaultDivePlanRepository } from '../repositories/default-dive-plan-repository';
import { useDeleteDivePlanMutation, useDivePlansQuery, useSaveDivePlanMutation } from './use-dive-plan-queries';
import { useOptionalAccountData } from './account-data';

type UseDivePlansOptions = {
  repository?: DivePlanRepository;
  queryScope?: string;
};

type DivePlanRepositoryWithSyncList = DivePlanRepository & {
  listSync?: () => DivePlan[];
};

/** Plan localId → the `updatedAt` of the version a successful watch update carried. */
type PlannedWatchSentVersions = ReadonlyMap<string, number>;

/** The last successful planned-dive update: the link status it returned and the plan versions it carried. */
type PlannedWatchSync = {
  status: PlannedWatchDivesUpdateStatus;
  sentVersions: PlannedWatchSentVersions;
};

/**
 * The watch-visible plans an update carries, by the `updatedAt` stored on this phone. It is only
 * ever matched exactly against the same plan's `updatedAt`, never read as a clock.
 */
function sentPlanVersions(plans: readonly DivePlan[]): PlannedWatchSentVersions {
  return new Map(plans.filter(isWatchVisiblePlan).map(plan => [plan.localId, plan.updatedAt]));
}

function sameSentVersions(left: PlannedWatchSentVersions, right: PlannedWatchSentVersions): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const [localId, updatedAt] of left) {
    if (right.get(localId) !== updatedAt) {
      return false;
    }
  }
  return true;
}

export const useDivePlans = (options: UseDivePlansOptions = {}) => {
  const accountData = useOptionalAccountData();
  const repository = options.repository ?? accountData?.planRepository ?? defaultDivePlanRepository;
  const queryScope = options.queryScope ?? (options.repository ? undefined : accountData?.queryScope);
  const initialPlans = React.useMemo(() => {
    const repositoryWithSyncList = repository as DivePlanRepositoryWithSyncList;

    if (typeof repositoryWithSyncList.listSync === 'function') {
      return repositoryWithSyncList.listSync();
    }

    return undefined;
  }, [repository]);
  const plansQuery = useDivePlansQuery(repository, {
    initialData: initialPlans,
    staleTime: Infinity,
    queryScope,
  });
  const savePlanMutation = useSaveDivePlanMutation(repository, { queryScope });
  const deletePlanMutation = useDeleteDivePlanMutation(repository, { queryScope });
  const plans = React.useMemo(
    () => plansQuery.data ?? initialPlans ?? [],
    [initialPlans, plansQuery.data],
  );
  // The status and the versions are stored together so a plan only counts as sent with the status
  // of the very update that carried it.
  const [plannedWatchSync, setPlannedWatchSync] = React.useState<PlannedWatchSync | undefined>();
  // Background refetches (each cloud page, each save) stay silent; only a requested refresh
  // shows the refreshing state.
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const refresh = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (!options.repository) {
        try {
          await accountData?.refreshCloudData();
        } catch {
          // Account state retains local rows and exposes the retryable cloud issue.
        }
      }
      await plansQuery.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [accountData, options.repository, plansQuery]);
  const savePlan = React.useCallback(async (plan: DivePlan) => {
    const saved = await savePlanMutation.mutateAsync(plan);
    if (!options.repository) {
      void accountData?.requestSync();
    }
    return saved;
  }, [accountData, options.repository, savePlanMutation]);
  const deletePlan = React.useCallback(async (localId: string) => {
    await deletePlanMutation.mutateAsync(localId);
    if (!options.repository) {
      void accountData?.requestSync();
    }
  }, [accountData, deletePlanMutation, options.repository]);

  const principalSettled = accountData?.isPrincipalSettled ?? true;
  const plansLoaded = plansQuery.data !== undefined || initialPlans !== undefined;

  React.useEffect(() => {
    if (!principalSettled || !plansLoaded) {
      return;
    }
    let isCurrent = true;

    const sentVersions = sentPlanVersions(plans);

    void defaultWatchLink.updatePlannedDives(plans)
      .then(status => {
        if (isCurrent) {
          // Keep the previous object when nothing changed, so a repeated update does not re-render.
          setPlannedWatchSync(previous =>
            previous && previous.status === status && sameSentVersions(previous.sentVersions, sentVersions)
              ? previous
              : { status, sentVersions },
          );
        }
      })
      .catch(error => {
        console.warn('Failed to update planned watch dives', error);
      });

    return () => {
      isCurrent = false;
    };
  }, [plans, plansLoaded, principalSettled]);

  return {
    plans,
    refresh,
    savePlan,
    deletePlan,
    isLoading: plansQuery.isLoading,
    isRefreshing,
    isSaving: savePlanMutation.isPending,
    isDeleting: deletePlanMutation.isPending,
    plannedWatchSyncStatus: plannedWatchSync?.status,
    /** Which plan versions the last successful watch update carried; a newer edit is not sent yet. */
    plannedWatchSentVersions: plannedWatchSync?.sentVersions,
    listError: plansQuery.error,
    saveError: savePlanMutation.error,
    deleteError: deletePlanMutation.error,
  };
};
