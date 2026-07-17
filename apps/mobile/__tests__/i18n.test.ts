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
    expect(i18n.t('auth.login.title')).toBe('로그인');
    expect(i18n.getResource('en', 'translation', 'auth.login.title')).toBe('Log in');
    expect(i18n.t('auth.onboarding.submit')).toBe('동의하고 계속');
    expect(i18n.getResource('en', 'translation', 'auth.onboarding.submit')).toBe('Agree and continue');
    expect(i18n.t('settings.account.offlineDescription')).toContain('로컬 데이터');
    expect(i18n.getResource('en', 'translation', 'settings.account.offlineDescription')).toContain('Local data');
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
