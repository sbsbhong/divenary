import { divePlanToDiveLogEntryDraft } from '../src/utils/dive-plan-to-log-entry';
import type { DivePlan } from '../src/types/dive-plan';

const completedPlan: DivePlan = {
  localId: 'plan-1',
  status: 'completed',
  createdAt: 100,
  updatedAt: 200,
  completedAt: 200,
  title: 'Blue Wall plan',
  diveMode: 'scuba',
  entryStyle: 'boat',
  site: { siteId: 'site-1', name: 'Blue Wall' },
  buddyIds: ['Mina'],
  gearIds: ['bcd-1'],
  tags: ['training'],
  objective: 'Buoyancy check',
  notes: 'Review current before entering.',
  plannedValues: {
    plannedMaxDepthMeters: 24,
    plannedDurationMinutes: 45,
    gasLabel: 'EAN32',
    visibilityExpectation: 4,
    perceivedDifficulty: 3,
    trainingFocus: 'hovering',
  },
  checklistItems: [{ id: 'gear', label: 'Gear', completed: true }],
};

describe('divePlanToDiveLogEntryDraft', () => {
  it('copies safe metadata into a manual log draft', () => {
    const draft = divePlanToDiveLogEntryDraft(completedPlan, { localId: 'manual-from-plan', now: 300 });

    expect(draft).toMatchObject({
      localId: 'manual-from-plan',
      source: 'manual',
      cloudSyncStatus: 'notConfigured',
      manual: {
        entryStyle: 'boat',
        site: { siteId: 'site-1', name: 'Blue Wall' },
        buddyIds: ['Mina'],
        gearIds: ['bcd-1'],
        tags: ['training'],
        measuredValues: {
          diveMode: 'scuba',
          gasLabel: 'EAN32',
        },
      },
    });
    expect(draft.manual.notes).toContain('Buoyancy check');
    expect(draft.manual.notes).toContain('hovering');
  });

  it('does not copy planned depth or duration into measured log values', () => {
    const draft = divePlanToDiveLogEntryDraft(completedPlan, { now: 300 });

    expect(draft.manual.measuredValues.maxDepthMeters).toBeUndefined();
    expect(draft.manual.measuredValues.durationSeconds).toBeUndefined();
    expect(draft.manual.measuredValues.visibilityRating).toBeUndefined();
    expect(draft.manual.measuredValues.perceivedExertion).toBeUndefined();
  });

  it('copies planned scuba pressure as editable manual metadata without measured depth or duration', () => {
    const draft = divePlanToDiveLogEntryDraft(
      {
        localId: 'plan-pressure',
        status: 'completed',
        createdAt: 100,
        updatedAt: 200,
        diveMode: 'scuba',
        site: { name: 'Pressure Reef' },
        buddyIds: [],
        gearIds: [],
        tags: [],
        plannedValues: {
          gasLabel: 'Air',
          plannedPressure: { unit: 'bar', start: 200, end: 70 },
          plannedMaxDepthMeters: 24,
          plannedDurationMinutes: 45,
        },
        checklistItems: [],
      },
      { localId: 'draft-pressure', now: 300 },
    );

    expect(draft.manual.measuredValues.pressure).toEqual({ unit: 'bar', start: 200, end: 70 });
    expect(draft.manual.measuredValues.gasLabel).toBe('Air');
    expect(draft.manual.measuredValues.maxDepthMeters).toBeUndefined();
    expect(draft.manual.measuredValues.durationSeconds).toBeUndefined();
  });
});
