import i18n, { resolveSupportedLanguage, supportedLanguages } from '../src/i18n';
import resources from '../src/i18n/resources';
import { formatDate, formatRating } from '../src/utils/dive-formatters';

describe('mobile i18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ko');
  });

  test('uses Korean fallback and ships Korean and English resources', () => {
    expect(i18n.options.fallbackLng).toEqual(['ko']);
    expect(supportedLanguages).toEqual(['ko', 'en']);

    expect(i18n.t('navigation.logbook')).toBe('로그북');
    expect(i18n.getResource('en', 'translation', 'navigation.logbook')).toBe('Logbook');
    expect(i18n.t('navigation.settings')).toBe('설정');
    expect(i18n.getResource('en', 'translation', 'navigation.settings')).toBe('Settings');
    expect(i18n.t('settings.theme.system')).toBe('시스템 기본값');
    expect(i18n.getResource('en', 'translation', 'settings.theme.system')).toBe('System default');
    expect(i18n.t('settings.language.english')).toBe('English');
  });

  test('ships complete social login, consent, and account status copy', () => {
    expect(i18n.t('auth.login.title')).toBe('Divenary 로그인');
    expect(i18n.getResource('en', 'translation', 'auth.login.title')).toBe('Sign in to Divenary');
    expect(i18n.t('auth.login.google')).toBe('Google로 계속하기');
    expect(i18n.t('auth.login.apple')).toBe('Apple로 계속하기');
    expect(i18n.t('auth.login.recent')).toBe('최근 사용');
    expect(i18n.getResource('en', 'translation', 'auth.login.recent')).toBe('Recently used');
    expect(i18n.t('auth.onboarding.submit')).toBe('동의하고 계속');
    expect(i18n.getResource('en', 'translation', 'auth.onboarding.submit')).toBe('Agree and continue');
    // Offline copy talks about the diver's records, not local data or the cloud.
    expect(i18n.t('settings.account.offlineDescription')).toContain('이 기기에 저장된 기록');
    expect(i18n.t('settings.account.offlineDescription')).not.toMatch(/로컬|클라우드/);
    expect(i18n.getResource('en', 'translation', 'settings.account.offlineDescription')).not.toMatch(/local data|cloud/i);
  });

  test('ships concise Korean and English account claim copy', () => {
    expect(i18n.t('accountClaim.choiceTitle')).toBe(
      '로그인 전에 남긴 기록을 계정으로 옮길까요?',
    );
    expect(i18n.t('accountClaim.logCountValue', { count: 3 })).toBe('다이빙 기록 3개');
    expect(i18n.t('accountClaim.planCountValue', { count: 2 })).toBe('다이빙 계획 2개');
    expect(i18n.t('accountClaim.importAction')).toBe('계정으로 옮기기');
    expect(i18n.t('accountClaim.keepAction')).toBe('기기에만 보관');
    expect(i18n.t('accountClaim.closeAction')).toBe('닫기');
    expect(i18n.t('accountClaim.progressTitle')).toBe('기록을 계정으로 옮기는 중');
    expect(
      i18n.t('accountClaim.progressCount', { completed: 3, total: 32 }),
    ).toBe('3 / 32');
    expect(i18n.t('accountClaim.failureTitle')).toBe(
      '기록 옮기기를 마치지 못했습니다',
    );
    expect(i18n.t('accountClaim.retryAction')).toBe('다시 시도');
    expect(i18n.t('accountClaim.deviceBadge')).toBe('이 기기에만 저장');
    expect(i18n.t('logbook.demoCapture')).toBe('데모');
    expect(i18n.t('accountClaim.settingsAction')).toBe(
      '로그인 전 기록 옮기기',
    );

    expect(
      i18n.getResource('en', 'translation', 'accountClaim.choiceTitle'),
    ).toBe('Move records made before sign-in to your account?');
    expect(
      i18n.getResource('en', 'translation', 'accountClaim.progressCount'),
    ).toBe('{{completed}} / {{total}}');
    expect(
      i18n.getResource('en', 'translation', 'accountClaim.keepAction'),
    ).toBe('Keep on this device');
    expect(
      i18n.getResource('en', 'translation', 'accountClaim.closeAction'),
    ).toBe('Close');
    expect(
      i18n.getResource('en', 'translation', 'accountClaim.deviceBadge'),
    ).toBe('Only on this device');
    expect(i18n.getResource('en', 'translation', 'logbook.demoCapture')).toBe('Demo');

    const en = i18n.getFixedT('en');
    expect(en('accountClaim.partialCompleteSummary', { count: 1 })).toBe('Moved 1 record to your account.');
    expect(en('accountClaim.retainedNotice', { count: 2 })).toBe('2 records weren’t moved and are still on this device.');
    expect(en('accountClaim.completeAnnouncement', { count: 1 })).toBe('Moved 1 record to your account');
    expect(en('accountClaim.settingsCount', { count: 1 })).toBe('1 record');
  });

  test('keeps Korean and English translation leaf keys in parity', () => {
    expect(logicalLeafKeys(resources.ko.translation)).toEqual(logicalLeafKeys(resources.en.translation));
  });

  test('resolves only supported device language codes', () => {
    expect(resolveSupportedLanguage('ko-KR')).toBe('ko');
    expect(resolveSupportedLanguage('en-US')).toBe('en');
    expect(resolveSupportedLanguage('ja-JP')).toBe('ko');
    expect(resolveSupportedLanguage()).toBe('ko');
  });

  test('formats fallback labels with the active translation copy', () => {
    expect(formatDate(undefined, i18n.language, i18n.t('formatters.unknownDate'))).toBe('--');
    expect(formatRating(undefined, i18n.t('formatters.notRated'))).toBe('평점 없음');
  });

  // Screens other than the unconnected memory preview; the local test account button is development-only.
  const DIVER_FACING_EXCLUSIONS = /^(memory\.|auth\.login\.development$)/;

  test('keeps internal terms out of diver-facing copy', () => {
    const internalTerms =
      /게스트|guest|클라우드|cloud|동기화|\bsync|outbox|payload|principal|세션|\bsession|provider|runtime|기기 데이터|device data|\bimport/i;

    for (const language of ['ko', 'en'] as const) {
      const leaks = leafEntries(resources[language].translation)
        .filter(([key]) => !DIVER_FACING_EXCLUSIONS.test(key))
        .filter(([, value]) => internalTerms.test(value.replace(/\{\{[^}]+\}\}/g, '')))
        .map(([key, value]) => `${language} ${key}: ${value}`);

      expect(leaks).toEqual([]);
    }
  });

  test('uses one term for the same thing across screens', () => {
    const ko = i18n.getFixedT('ko');
    const en = i18n.getFixedT('en');

    // Watch to iPhone is "get watch logs", never sync.
    expect(ko('logbook.syncWatch')).toBe('워치 기록 가져오기');
    expect(en('logbook.syncWatch')).toBe('Get watch logs');
    // Field names match between the log and the plan, and the plan error names the field it sits under.
    for (const [logKey, planKey] of [
      ['logbook.siteName', 'planning.siteName'],
      ['logbook.diveMode', 'planning.diveMode'],
      ['logbook.trainingFocus', 'planning.trainingFocus'],
      ['logbook.startedAt', 'planning.plannedAt'],
      ['logbook.sectionDetails', 'planning.sections.details'],
      ['logbook.airGas', 'planning.air'],
    ]) {
      expect(ko(logKey)).toBe(ko(planKey));
      expect(en(logKey)).toBe(en(planKey));
    }
    expect(ko('validation.siteNameRequired')).toContain(ko('planning.siteName'));
    // One create label, one next-plan label and one count wording.
    expect(ko('logbook.createManual')).toBe(ko('home.createLog'));
    expect(ko('planning.createLogFromPlan')).toBe(ko('home.createLog'));
    expect(ko('planning.completedPrompt.create')).toBe(ko('home.createLog'));
    expect(en('planning.completedPrompt.create')).toBe(en('home.createLog'));
    expect(ko('home.nextPlan')).toBe(ko('planning.nextDive'));
    expect(en('home.nextPlan')).toBe(en('planning.nextDive'));
    expect(ko('logbook.totalCount', { count: 3 })).toBe(ko('home.logCount', { count: 3 }));
    expect(ko('logbook.deleteLog')).toContain('기록');
    expect(ko('logbook.deleteConfirm.title')).toContain('기록');
  });

  test('keeps the recommended stop a non-certified reminder in every status', () => {
    const ko = i18n.getFixedT('ko');
    const en = i18n.getFixedT('en');

    expect(ko('logbook.watchScuba.safetyStopRecommended')).toBe('권장 스탑');
    expect(en('logbook.watchScuba.safetyStopRecommended')).toBe('Recommended stop');
    expect(ko('logbook.watchScuba.safetyStopStatuses.unknown')).toBe('--');
    expect(en('logbook.watchScuba.safetyStopStatuses.unknown')).toBe('--');

    for (const [language, required] of [
      ['ko', /필수|의무|감압|세이프티|위험/],
      ['en', /required|mandatory|decompression|safety stop|danger/i],
    ] as const) {
      const statuses = leafEntries(resources[language].translation.logbook.watchScuba);
      expect(statuses.filter(([, value]) => required.test(value))).toEqual([]);
    }
  });

  test('gives English count copy singular and plural forms', () => {
    const missing = leafEntries(resources.en.translation)
      .filter(([key, value]) => value.includes('{{count}}') && !/_(one|other)$/.test(key))
      // "Label: {{count}}" reads correctly for any number.
      .filter(([, value]) => !/:\s*\{\{count\}\}/.test(value))
      .map(([key]) => key);

    expect(missing).toEqual([]);
  });
});

function leafEntries(value: object, prefix = ''): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, child]): Array<[string, string]> => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'object' && child !== null ? leafEntries(child, path) : [[path, String(child)]];
  });
}

function leafKeys(value: object, prefix = ''): string[] {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof child === 'object' && child !== null ? leafKeys(child, path) : [path];
    })
    .sort();
}

function logicalLeafKeys(value: object): string[] {
  return [...new Set(leafKeys(value).map(key => key.replace(/_(one|other)$/, '')))].sort();
}
