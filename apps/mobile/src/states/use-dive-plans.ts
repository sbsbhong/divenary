import React from 'react';
import { updatePlannedWatchDives, type PlannedWatchDivesUpdateStatus } from '../native/watch-connectivity';
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
  const [plannedWatchSyncStatus, setPlannedWatchSyncStatus] = React.useState<PlannedWatchDivesUpdateStatus | undefined>();
  const refresh = React.useCallback(async () => {
    if (!options.repository) {
      try {
        await accountData?.refreshCloudData();
      } catch {
        // Account state retains local rows and exposes the retryable cloud issue.
      }
    }
    await plansQuery.refetch();
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

    void updatePlannedWatchDives(plans)
      .then(status => {
        if (isCurrent) {
          setPlannedWatchSyncStatus(status);
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
    isRefreshing: plansQuery.isRefetching,
    isSaving: savePlanMutation.isPending,
    isDeleting: deletePlanMutation.isPending,
    plannedWatchSyncStatus,
    listError: plansQuery.error,
    saveError: savePlanMutation.error,
    deleteError: deletePlanMutation.error,
  };
};
