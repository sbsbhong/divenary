import type { TFunction } from 'i18next';
import { isWatchVisiblePlan, type PlannedWatchDivesUpdateStatus } from '../../companion/watch-link';
import type { InstrumentTone } from '../../components/ui/theme';
import type { DivePlan, DivePlanChecklistItem, DivePlanStatus } from '../../types/dive-plan';

/** The fields `계획 확정` needs. A draft may leave any of them empty. */
export type PlanRequiredField = 'plannedAt' | 'diveMode' | 'siteName' | 'plannedMaxDepth' | 'plannedDuration';

export function getMissingPlanFields(plan: DivePlan): PlanRequiredField[] {
  const missing: PlanRequiredField[] = [];

  if (plan.plannedAt === undefined) {
    missing.push('plannedAt');
  }
  if (!plan.diveMode) {
    missing.push('diveMode');
  }
  if (!plan.site.name?.trim()) {
    missing.push('siteName');
  }
  if (plan.plannedValues.plannedMaxDepthMeters === undefined) {
    missing.push('plannedMaxDepth');
  }
  if (plan.plannedValues.plannedDurationMinutes === undefined) {
    missing.push('plannedDuration');
  }

  return missing;
}

export function planTitle(plan: DivePlan, t: TFunction): string {
  return plan.title ?? plan.site.name ?? t('planning.untitledPlan');
}

/** A plan that is not completed and whose day is already over. A plan later today is not past. */
export function isPlanDatePassed(plan: DivePlan, nowMs: number = Date.now()): boolean {
  if (plan.status === 'completed' || plan.plannedAt === undefined) {
    return false;
  }

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  return plan.plannedAt < startOfToday;
}

/** The nearest planned dive that has not started yet. Drafts, completed and past plans are skipped. */
export function selectNextPlan(plans: readonly DivePlan[], nowSeconds: number): DivePlan | undefined {
  let nextPlan: DivePlan | undefined;

  for (const plan of plans) {
    if (plan.status !== 'planned' || plan.plannedAt === undefined || plan.plannedAt < nowSeconds) {
      continue;
    }

    if (!nextPlan || plan.plannedAt < (nextPlan.plannedAt ?? Infinity)) {
      nextPlan = plan;
    }
  }

  return nextPlan;
}

/** Status chips stay low-chroma: blue is kept for actions and selection. */
export function planStatusTone(status: DivePlanStatus): InstrumentTone {
  return status === 'planned' ? 'secondary' : 'muted';
}

const DEFAULT_CHECKLIST_IDS = new Set(['site', 'buddy', 'gear']);

/** Default items are stored with an English label; they are shown in the current language by id. */
export function checklistItemLabel(item: DivePlanChecklistItem, t: TFunction): string {
  return DEFAULT_CHECKLIST_IDS.has(item.id) ? t(`planning.checklistDefaults.${item.id}`) : item.label;
}

export type PlanWatchState = 'sent' | 'needsConnection' | 'phoneOnly';

/**
 * What the phone actually knows about a plan on the watch. The planned dive context is a
 * latest-value handoff without a receipt, so "sent" never claims the watch can already pick it.
 * Undefined while a sendable plan has no link status yet.
 */
export function getPlanWatchState(
  plan: DivePlan,
  status: PlannedWatchDivesUpdateStatus | undefined,
): PlanWatchState | undefined {
  if (!isWatchVisiblePlan(plan)) {
    return 'phoneOnly';
  }

  if (!status) {
    return undefined;
  }

  const linked =
    status.nativeBridgeAvailable !== false &&
    status.isSupported &&
    status.isPaired &&
    status.isWatchAppInstalled &&
    status.activationState === 'activated';
  const hasContextError = status.lastContextErrorCode !== undefined || Boolean(status.lastContextErrorDescription);

  return linked && !hasContextError ? 'sent' : 'needsConnection';
}

/** Planned depth to one decimal, like the log screens. */
export function formatPlanDepth(meters: number): string {
  return `${meters.toFixed(1)} m`;
}
