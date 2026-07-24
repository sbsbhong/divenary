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
    expect(i18n.getResource('en', 'translation', 'auth.login.title')).toBe('Log in to Divenary');
    expect(i18n.t('auth.login.google')).toBe('Google로 계속하기');
    expect(i18n.t('auth.login.apple')).toBe('Apple로 계속하기');
    expect(i18n.t('auth.login.recent')).toBe('최근 사용');
    expect(i18n.getResource('en', 'translation', 'auth.login.recent')).toBe('Recently used');
    expect(i18n.t('auth.onboarding.submit')).toBe('동의하고 계속');
    expect(i18n.getResource('en', 'translation', 'auth.onboarding.submit')).toBe('Agree and continue');
    expect(i18n.t('settings.account.offlineDescription')).toContain('로컬 데이터');
    expect(i18n.getResource('en', 'translation', 'settings.account.offlineDescription')).toContain('Local data');
  });

  test('ships concise Korean and English account claim copy', () => {
    expect(i18n.t('accountClaim.choiceTitle')).toBe(
      '기기 데이터를 계정으로 가져올까요?',
    );
    expect(i18n.t('accountClaim.logCount')).toBe('다이빙 로그');
    expect(i18n.t('accountClaim.planCount')).toBe('다이빙 계획');
    expect(i18n.t('accountClaim.importAction')).toBe('계정으로 가져오기');
    expect(i18n.t('accountClaim.keepAction')).toBe('기기에 유지');
    expect(i18n.t('accountClaim.progressTitle')).toBe('계정으로 가져오는 중');
    expect(
      i18n.t('accountClaim.progressCount', { completed: 3, total: 32 }),
    ).toBe('3 / 32');
    expect(i18n.t('accountClaim.failureTitle')).toBe(
      '가져오기를 완료하지 못했습니다',
    );
    expect(i18n.t('accountClaim.retryAction')).toBe('다시 시도');
    expect(i18n.t('accountClaim.deviceBadge')).toBe('이 기기에만 저장');
    expect(i18n.t('logbook.demoCapture')).toBe('데모');
    expect(i18n.t('accountClaim.settingsAction')).toBe(
      '기기 데이터 가져오기',
    );

    expect(
      i18n.getResource('en', 'translation', 'accountClaim.choiceTitle'),
    ).toBe('Import device data to your account?');
    expect(
      i18n.getResource('en', 'translation', 'accountClaim.progressCount'),
    ).toBe('{{completed}} / {{total}}');
    expect(
      i18n.getResource('en', 'translation', 'accountClaim.keepAction'),
    ).toBe('Keep on device');
    expect(
      i18n.getResource('en', 'translation', 'accountClaim.deviceBadge'),
    ).toBe('Only on this device');
    expect(i18n.getResource('en', 'translation', 'logbook.demoCapture')).toBe('Demo');
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
    expect(formatDate(undefined, i18n.language, i18n.t('formatters.unknownDate'))).toBe('알 수 없는 날짜');
    expect(formatRating(undefined, i18n.t('formatters.notRated'))).toBe('평가 없음');
  });
});

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
