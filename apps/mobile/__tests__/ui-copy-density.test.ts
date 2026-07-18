import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readScreen(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src/screens', relativePath), 'utf8');
}

function readResourceValues(): string {
  return readFileSync(resolve(process.cwd(), 'src/i18n/resources.ts'), 'utf8');
}

describe('mobile visible-copy policy', () => {
  test('keeps screen chrome free of repeated guidance and placeholder workflow copy', () => {
    const home = readScreen('home/screen.tsx');
    const login = readScreen('auth/login-screen.tsx');
    const onboarding = readScreen('auth/onboarding-screen.tsx');
    const logbook = readScreen('logbook/screen.tsx');
    const planning = readScreen('planning/screen.tsx');
    const memory = readScreen('memory/screen.tsx');
    const settings = readScreen('settings/screen.tsx');
    const resources = readResourceValues();

    expect(home).not.toContain("t('home.subtitle')");
    expect(home).not.toContain('home-reminder-alert');
    expect(login).not.toContain('StatusPill');
    expect(onboarding).not.toContain("t('auth.onboarding.subtitle')");
    expect(logbook).not.toContain("t('logbook.reviewEyebrow')");
    expect(logbook).not.toContain("t('logbook.emptyBody')");
    expect(planning).not.toContain("t('planning.subtitle')");
    expect(planning).not.toContain("t('planning.completedPromptBody'");
    expect(memory).not.toContain("t('memory.subtitle')");
    expect(memory).not.toContain("t('memory.exportStatus')");
    expect(memory).not.toContain("t('memory.reviewOnlySummaries')");
    expect(memory).not.toContain("t('memory.savePreview')");
    expect(settings).not.toContain("t('settings.subtitle')");
    expect(settings).not.toContain("t('settings.theme.subtitle')");
    expect(settings).not.toContain("t('settings.language.subtitle')");
    expect(settings).not.toContain("t('settings.notifications.subtitle')");
    expect(home).not.toContain("<DiveSummaryCard.Header eyebrow={t('home.latestLog')} title={t('home.noRecentLog')} />");
    expect(logbook).not.toContain("t('logbook.emptyEyebrow')");
    expect(planning).not.toContain("t('planning.emptyEyebrow')");
    expect(memory).not.toContain("t('memory.staticPreview')");
    expect(memory).not.toContain("t('memory.safeAnalytics')");
    expect(resources).not.toContain('photoImportPlaceholder');
    expect(resources).not.toMatch(/:\s*'[^']*(?:this build|이 빌드|placeholder|플레이스홀더)/i);
  });
});
