import { LocalDivePlanRepository } from '../src/repositories/local-dive-plan-repository';
import type { DivePlan } from '../src/types/dive-plan';

const plan = (overrides: Partial<DivePlan>): DivePlan => ({
  localId: 'plan-base',
  status: 'draft',
  createdAt: 100,
  updatedAt: 100,
  site: {},
  buddyIds: [],
  gearIds: [],
  tags: [],
  plannedValues: {},
  checklistItems: [],
  ...overrides,
});

describe('LocalDivePlanRepository', () => {
  it('clones plans on save and list so callers cannot mutate stored state', async () => {
    const repository = new LocalDivePlanRepository();
    const saved = await repository.save(
      plan({
        localId: 'plan-1',
        site: { name: 'Original Reef' },
        checklistItems: [{ id: 'gear', label: 'Gear', completed: false }],
      }),
    );

    saved.site.name = 'Mutated Reef';
    saved.checklistItems[0].completed = true;
    const [listed] = await repository.list();
    listed.site.name = 'Listed Mutation';

    expect((await repository.get('plan-1'))?.site.name).toBe('Original Reef');
    expect((await repository.get('plan-1'))?.checklistItems[0].completed).toBe(false);
  });

  it('sorts active planning relevance before completed plans', async () => {
    const repository = new LocalDivePlanRepository(
      [
        plan({ localId: 'completed', status: 'completed', completedAt: 210, updatedAt: 210 }),
        plan({ localId: 'future-planned', status: 'planned', plannedAt: 500, updatedAt: 150 }),
        plan({ localId: 'draft', status: 'draft', updatedAt: 300 }),
        plan({ localId: 'near-planned', status: 'planned', plannedAt: 400, updatedAt: 180 }),
      ],
      { now: () => 350 },
    );

    expect((await repository.list()).map(currentPlan => currentPlan.localId)).toEqual([
      'near-planned',
      'future-planned',
      'draft',
      'completed',
    ]);
  });

  it('deletes a saved plan', async () => {
    const repository = new LocalDivePlanRepository([plan({ localId: 'plan-1' })]);

    await repository.delete('plan-1');

    expect(await repository.get('plan-1')).toBeUndefined();
    expect(await repository.list()).toEqual([]);
  });

  it('conditionally deletes only the record observed inside its mutation queue', async () => {
    const original = plan({localId: 'plan-1', updatedAt: 100});
    const repository = new LocalDivePlanRepository([original]);
    const changed = {...original, status: 'completed' as const, updatedAt: 200};

    const saving = repository.save(changed);
    const deleting = (repository as unknown as {
      deleteIf(
        localId: string,
        predicate: (current: DivePlan) => boolean,
      ): Promise<string>;
    }).deleteIf('plan-1', current => current.updatedAt === original.updatedAt);

    await saving;
    await expect(deleting).resolves.toBe('conditionFailed');
    await expect(repository.get('plan-1')).resolves.toMatchObject({updatedAt: 200});
  });
});
