import type { DivePlan, DivePlanChecklistItem } from '../types/dive-plan';

const currentTimestampSeconds = () => Date.now() / 1000;

/** A draft the diver confirmed (계획 확정). Only a planned dive reaches the watch. */
export function toPlannedDivePlan(plan: DivePlan, now: number = currentTimestampSeconds()): DivePlan {
  return { ...plan, status: 'planned', updatedAt: now };
}

/** A plan the diver marked completed. Completing never writes a log by itself. */
export function toCompletedDivePlan(plan: DivePlan, now: number = currentTimestampSeconds()): DivePlan {
  return { ...plan, status: 'completed', completedAt: now, updatedAt: now };
}

/** The plan with a ticked or cleared checklist; nothing else about the plan changes. */
export function withDivePlanChecklist(
  plan: DivePlan,
  checklistItems: DivePlanChecklistItem[],
  now: number = currentTimestampSeconds(),
): DivePlan {
  return { ...plan, checklistItems, updatedAt: now };
}
