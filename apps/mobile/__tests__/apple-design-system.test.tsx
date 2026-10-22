import React from 'react';
import { Pressable, StatusBar } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import Providers from '../src/providers';
import { GluestackUIProvider } from '../src/components/ui/gluestack-ui-provider';
import { colors } from '../src/components/ui/gluestack-ui-provider/config';
import { useAppPreferences } from '../src/states/app-preferences';

const mockSetColorScheme = jest.fn();

jest.mock('../src/states/auth', () => {
  const ReactModule = require('react') as typeof import('react');

  return {
    AuthProvider: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    useAuth: () => ({ state: { status: 'guest' } }),
  };
});

jest.mock('../src/states/account-data', () => {
  const ReactModule = require('react') as typeof import('react');

  return {
    AccountDataProvider: ({children}: {children?: React.ReactNode}) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react') as typeof import('react');
  const actual = jest.requireActual('react-native-safe-area-context');
  const metrics = {
    frame: { width: 320, height: 640, x: 0, y: 0 },
    insets: { left: 0, right: 0, bottom: 0, top: 0 },
  };

  return {
    ...actual,
    initialWindowMetrics: metrics,
    useSafeAreaFrame: jest.fn(() => metrics.frame),
    useSafeAreaInsets: jest.fn(() => metrics.insets),
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('nativewind', () => {
  const actual = jest.requireActual('nativewind');

  return {
    ...actual,
    useColorScheme: jest.fn(() => ({
      colorScheme: 'light',
      setColorScheme: mockSetColorScheme,
    })),
  };
});

const readSource = (...segments: string[]) => {
  const nodeRequire = require as (moduleName: string) => {
    readFileSync: (filePath: string, encoding: 'utf8') => string;
  };
  const fs = nodeRequire('fs');
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd();

  return fs.readFileSync(`${cwd}/${segments.join('/')}`, 'utf8');
};

// Files the DESIGN.md guard reads. Screens first, then the shared parts that screens compose.
const DESIGN_GUARDED_SCREENS: ReadonlyArray<readonly string[]> = [
  ['src', 'screens', 'auth', 'login-screen.tsx'],
  ['src', 'screens', 'auth', 'onboarding-screen.tsx'],
  ['src', 'screens', 'home', 'screen.tsx'],
  ['src', 'screens', 'logbook', 'screen.tsx'],
  ['src', 'screens', 'logbook', 'log-entry-editor.tsx'],
  ['src', 'screens', 'logbook', 'log-entry-mode-fields.tsx'],
  ['src', 'screens', 'logbook', 'log-entry-watch-fields.tsx'],
  ['src', 'screens', 'logbook', 'log-entry-detail.tsx'],
  ['src', 'screens', 'logbook', 'log-entry-profile.tsx'],
  ['src', 'screens', 'planning', 'screen.tsx'],
  ['src', 'screens', 'planning', 'plan-detail.tsx'],
  ['src', 'screens', 'planning', 'plan-editor.tsx'],
  ['src', 'screens', 'planning', 'plan-editor-sections.tsx'],
  ['src', 'screens', 'memory', 'screen.tsx'],
  ['src', 'screens', 'settings', 'screen.tsx'],
  ['src', 'screens', 'recovery', 'screen.tsx'],
  ['src', 'components', 'navigation', 'index.tsx'],
  // Editor files join here as they move onto the shared parts, for example
  // ['src', 'screens', 'logbook', 'log-entry-editor.tsx'] and ['src', 'screens', 'planning', 'plan-editor.tsx'].
];

const DESIGN_GUARDED_SHARED_PARTS: ReadonlyArray<readonly string[]> = [
  ['src', 'components', 'ui', 'dive-summary-card.tsx'],
  ['src', 'components', 'ui', 'instrument.tsx'],
  ['src', 'components', 'ui', 'session-profile.tsx'],
  ['src', 'components', 'ui', 'screen-header.tsx'],
  ['src', 'components', 'ui', 'grouped-list.tsx'],
  ['src', 'components', 'ui', 'sticky-action-bar.tsx'],
  ['src', 'components', 'ui', 'skeleton-block.tsx'],
  ['src', 'components', 'ui', 'detail-skeleton.tsx'],
  ['src', 'components', 'feedback', 'app-feedback.tsx'],
];

function ThemeToggle(): React.JSX.Element {
  const { setThemePreference } = useAppPreferences();

  return (
    <>
      <Pressable testID="set-dark-theme" onPress={() => setThemePreference('dark')} />
      <Pressable testID="set-system-theme" onPress={() => setThemePreference('system')} />
    </>
  );
}

describe('Apple design system mapping', () => {
  test('maps Gluestack semantic light tokens to the Apple-inspired palette', () => {
    expect(colors.light['--primary']).toBe('0 102 204');
    expect(colors.light['--primary-foreground']).toBe('255 255 255');
    expect(colors.light['--background']).toBe('245 245 247');
    expect(colors.light['--foreground']).toBe('29 29 31');
    expect(colors.light['--card']).toBe('255 255 255');
    expect(colors.light['--card-foreground']).toBe('29 29 31');
    expect(colors.light['--muted']).toBe('245 245 247');
    expect(colors.light['--muted-foreground']).toBe('122 122 122');
    expect(colors.light['--ring']).toBe('0 113 227');
    expect(colors.light['--warning']).toBe('167 79 0');
    expect(colors.dark['--warning']).toBe('255 159 10');
  });

  test('passes the system preference while resolving a light status surface', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Providers>{null}</Providers>);
    });

    const root = renderer!.root;

    expect(root.findByType(GluestackUIProvider).props.mode).toBe('system');
    expect(root.findByType(StatusBar).props.barStyle).toBe('dark-content');
    expect(mockSetColorScheme).toHaveBeenLastCalledWith('system');
  });

  test('updates Gluestack mode and status bar from runtime theme preference', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <Providers>
          <ThemeToggle />
        </Providers>,
      );
    });

    const root = renderer!.root;

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'set-dark-theme' }).props.onPress();
    });

    expect(root.findByType(GluestackUIProvider).props.mode).toBe('dark');
    expect(root.findByType(StatusBar).props.barStyle).toBe('light-content');

    await ReactTestRenderer.act(async () => {
      root.findByProps({ testID: 'set-system-theme' }).props.onPress();
    });

    expect(root.findByType(GluestackUIProvider).props.mode).toBe('system');
    expect(root.findByType(StatusBar).props.barStyle).toBe('dark-content');
    expect(mockSetColorScheme).toHaveBeenLastCalledWith('system');
  });

  test('keeps mobile screens within the Apple-style UI rules from DESIGN.md', () => {
    const source = [...DESIGN_GUARDED_SCREENS, ...DESIGN_GUARDED_SHARED_PARTS]
      .map(segments => readSource(...segments))
      .join('\n');

    expect(source).not.toMatch(/font-(mono|black|extrabold)/);
    expect(source).not.toMatch(/border-8/);
    expect(source).not.toMatch(/border border|border-t border|border-transparent/);
    expect(source).not.toMatch(/accent="(success|warning)"/);
    expect(source).not.toMatch(/tone="(success|warning)"/);
    // The weight ladder is 300/400/600/700; 500 is not part of it.
    expect(source).not.toMatch(/font-medium/);
    // No shadows. `shadow-none` only removes a vendored component's default shadow.
    expect(source).not.toMatch(/shadow-(?!none)/);
  });

  test('keeps status pills low-chroma instead of primary filled button styling', () => {
    const source = readSource('src', 'components', 'ui', 'instrument.tsx');
    const statusPillStyles = source.slice(source.indexOf('const pillStyles'), source.indexOf('export function StatusPill'));

    expect(statusPillStyles).not.toContain('bg-primary text-primary-foreground');
    expect(statusPillStyles).not.toContain('bg-secondary text-secondary-foreground');
    expect(statusPillStyles).toContain('bg-primary/10');
  });

  test('defines a semantic warning badge without destructive red styling', () => {
    const tailwindConfig = readSource('tailwind.config.js');
    const badge = readSource('src', 'components', 'ui', 'list-status-badge.tsx');

    expect(tailwindConfig).toContain("warning: 'rgb(var(--warning)/<alpha-value>)'");
    expect(tailwindConfig).toMatch(/foreground\|card\|popover\|muted\|destructive\|border\|input\|ring\|primary\|secondary\|background\|accent\|warning/);
    expect(badge).toContain('bg-warning/10');
    expect(badge).toContain('text-warning');
    expect(badge).not.toMatch(/red|destructive/);
  });

  test('uses a lightweight text Pressable for the Home login entry', () => {
    const source = readSource('src', 'screens', 'home', 'screen.tsx');

    expect(source).toMatch(/<Pressable[\s\S]*?testID="home-login-action"/);
    expect(source).not.toMatch(/<InstrumentButton[\s\S]{0,200}?testID="home-login-action"/);
  });

  test('registers Google Sans Medium for the custom Google sign-in label', () => {
    const iosInfoPlist = readSource('ios', 'Divenary', 'Info.plist');
    const iosProject = readSource('ios', 'Divenary.xcodeproj', 'project.pbxproj');
    const androidGradle = readSource('android', 'app', 'build.gradle');

    expect(iosInfoPlist).toContain('<string>GoogleSans-Medium.ttf</string>');
    expect(iosProject).toContain('GoogleSans-Medium.ttf in Resources');
    expect(androidGradle).toContain('assets.srcDirs += ["../../src/assets"]');
  });
});
