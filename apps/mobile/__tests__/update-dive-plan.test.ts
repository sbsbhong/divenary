import { toWatchPlannedDivePayloads } from '../src/companion/watch-link';
import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import type { DivePlan } from '../src/types/dive-plan';
import { createDefaultPlanChecklist } from '../src/utils/create-dive-plan';
import { toCompletedDivePlan, toPlannedDivePlan, withDivePlanChecklist } from '../src/utils/update-dive-plan';

const draft: DivePlan = {
  localId: 'plan-1',
  status: 'draft',
  createdAt: 100,
  updatedAt: 100,
  title: 'Blue Wall morning',
  plannedAt: 1781355000,
  diveMode: 'scuba',
  site: { name: 'Blue Wall' },
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: { plannedMaxDepthMeters: 18, plannedDurationMinutes: 45 },
  checklistItems: createDefaultPlanChecklist(),
};

async function storedPlan(repository: LocalDivePlanRepository): Promise<DivePlan> {
  const [plan] = await repository.list();
  return plan;
}

describe('plan status changes', () => {
  test('a confirmed plan is stored as planned and reaches the watch payload', async () => {
    const repository = new LocalDivePlanRepository([draft]);

    await repository.save(toPlannedDivePlan(draft, 200));

    const plan = await storedPlan(repository);
    expect(plan).toMatchObject({ status: 'planned', updatedAt: 200 });
    expect(plan.completedAt).toBeUndefined();
    expect(toWatchPlannedDivePayloads([plan]).map(payload => payload.localId)).toEqual(['plan-1']);
  });

  test('a completed plan is stored with its completion time and leaves the watch payload', async () => {
    const planned = toPlannedDivePlan(draft, 200);
    const repository = new LocalDivePlanRepository([planned]);

    await repository.save(toCompletedDivePlan(planned, 300));

    const plan = await storedPlan(repository);
    expect(plan).toMatchObject({ status: 'completed', completedAt: 300, updatedAt: 300 });
    expect(toWatchPlannedDivePayloads([plan])).toEqual([]);
  });

  test('a checklist tap is stored without changing the status', async () => {
    const planned = toPlannedDivePlan(draft, 200);
    const repository = new LocalDivePlanRepository([planned]);
    const ticked = planned.checklistItems.map(item => (item.id === 'site' ? { ...item, completed: true } : item));

    await repository.save(withDivePlanChecklist(planned, ticked, 250));

    const plan = await storedPlan(repository);
    expect(plan).toMatchObject({ status: 'planned', updatedAt: 250 });
    expect(plan.checklistItems.find(item => item.id === 'site')?.completed).toBe(true);
  });

  test('saves land in order, so completing after a tick keeps both', async () => {
    const planned = toPlannedDivePlan(draft, 200);
    const repository = new LocalDivePlanRepository([planned]);
    const ticked = planned.checklistItems.map(item => (item.id === 'gear' ? { ...item, completed: true } : item));

    // The detail sends the completion with the checklist it shows, while the tick is still saving.
    await Promise.all([
      repository.save(withDivePlanChecklist(planned, ticked, 250)),
      repository.save(toCompletedDivePlan({ ...planned, checklistItems: ticked }, 260)),
    ]);

    const plan = await storedPlan(repository);
    expect(plan).toMatchObject({ status: 'completed', completedAt: 260 });
    expect(plan.checklistItems.find(item => item.id === 'gear')?.completed).toBe(true);
  });
});
