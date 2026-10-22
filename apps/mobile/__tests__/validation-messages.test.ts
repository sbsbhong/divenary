import i18n from '../src/i18n';
import { numberValidationMessages } from '../src/screens/common/form/validation-messages';
import { logEntryFormSchema } from '../src/screens/logbook/log-entry-form-schema';

describe('form validation messages', () => {
  afterAll(async () => {
    await i18n.changeLanguage('ko');
  });

  test('uses Korean particles that match the field label', async () => {
    await i18n.changeLanguage('ko');

    expect(numberValidationMessages('duration', 'select').required).toBe('다이빙 시간을 선택해 주세요.');
    expect(numberValidationMessages('repetitionCount', 'select').required).toBe('다이빙 횟수를 선택해 주세요.');
    expect(numberValidationMessages('repetitionTarget', 'select').min).toBe('목표 횟수는 0 이상이어야 합니다.');
    expect(numberValidationMessages('maxDepth', 'select').min).toBe('최대 수심(m)은 0 이상이어야 합니다.');
    expect(numberValidationMessages('startPressure', 'enter', 'bar').max.replace('{max}', '300')).toBe(
      '시작 압력은 300 bar 이하로 입력해 주세요.',
    );
  });

  test('follows the current language when the schema validates', async () => {
    await i18n.changeLanguage('en');
    const result = logEntryFormSchema.safeParse({
      startedAt: undefined,
      diveMode: 'scuba',
      siteName: '  ',
      durationSeconds: undefined,
      maxDepthMeters: 12,
      gearIds: [],
      buddies: [],
      tags: [],
      observedMarineLife: [],
      pressure: { unit: 'bar' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors.siteName).toContain('Enter a dive site.');
      expect(fieldErrors.durationSeconds).toContain('Dive time is required.');
      expect(fieldErrors.startedAt).toContain('Choose a date and time.');
    }
    // The unit follows the limit after a space, as in the value rows.
    expect(numberValidationMessages('startPressure', 'enter', 'bar').max.replace('{max}', '300')).toBe(
      'Start pressure must be 300 bar or less.',
    );
  });
});
