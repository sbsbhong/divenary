import { createBlankDiveLogEntry } from '../src/utils/create-dive-log-entry';

describe('createBlankDiveLogEntry', () => {
  it('creates a deterministic manual entry with empty editable fields and manual provenance', () => {
    const entry = createBlankDiveLogEntry({
      localId: 'manual-entry-1',
      now: 1781353000,
    });

    expect(entry.localId).toBe('manual-entry-1');
    expect(entry.source).toBe('manual');
    expect(entry.cloudSyncStatus).toBe('notConfigured');
    expect(entry.createdAt).toBe(1781353000);
    expect(entry.updatedAt).toBe(1781353000);

    expect(entry.manual.site).toEqual({});
    expect(entry.manual.buddyIds).toEqual([]);
    expect(entry.manual.gearIds).toEqual([]);
    expect(entry.manual.tags).toEqual([]);
    expect(entry.manual.observedMarineLife).toEqual([]);
    expect(entry.manual.measuredValues).toEqual({});

    expect(entry.mobile.mediaPlaceholders).toEqual([]);
    expect(entry.watchCapture).toBeUndefined();

    expect(entry.provenance).toMatchObject({
      site: 'manual',
      buddyIds: 'manual',
      gearIds: 'manual',
      tags: 'manual',
      observedMarineLife: 'manual',
      notes: 'manual',
      rating: 'manual',
      measuredValues: 'manual',
      mediaPlaceholders: 'mobile',
    });
  });
});
