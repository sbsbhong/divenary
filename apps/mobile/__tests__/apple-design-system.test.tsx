import React from 'react';
import { Pressable, StatusBar } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import Providers from '../src/providers';
import { GluestackUIProvider } from '../src/components/ui/gluestack-ui-provider';
import { colors } from '../src/components/ui/gluestack-ui-provider/config';
import { useAppPreferences } from '../src/states/app-preferences';

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
      setColorScheme: jest.fn(),
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

function ThemeToggle(): React.JSX.Element {
  const { setThemePreference } = useAppPreferences();

  return <Pressable testID="set-dark-theme" onPress={() => setThemePreference('dark')} />;
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
  });

  test('uses light mode as the default resolved mobile surface', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Providers>{null}</Providers>);
    });

    const root = renderer!.root;

    expect(root.findByType(GluestackUIProvider).props.mode).toBe('light');
    expect(root.findByType(StatusBar).props.barStyle).toBe('dark-content');
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
  });

  test('keeps mobile screens within the Apple-style UI rules from DESIGN.md', () => {
    const source = [
      readSource('src', 'screens', 'auth', 'login-screen.tsx'),
      readSource('src', 'screens', 'auth', 'onboarding-screen.tsx'),
      readSource('src', 'screens', 'home', 'screen.tsx'),
      readSource('src', 'screens', 'logbook', 'screen.tsx'),
      readSource('src', 'screens', 'planning', 'screen.tsx'),
      readSource('src', 'screens', 'memory', 'screen.tsx'),
      readSource('src', 'screens', 'settings', 'screen.tsx'),
      readSource('src', 'components', 'navigation', 'index.tsx'),
      readSource('src', 'components', 'ui', 'dive-summary-card.tsx'),
      readSource('src', 'components', 'ui', 'instrument.tsx'),
      readSource('src', 'components', 'ui', 'session-profile.tsx'),
    ].join('\n');

    expect(source).not.toMatch(/font-(mono|black|extrabold)/);
    expect(source).not.toMatch(/border-8/);
    expect(source).not.toMatch(/border border|border-t border|border-transparent/);
    expect(source).not.toMatch(/accent="(success|warning)"/);
    expect(source).not.toMatch(/tone="(success|warning)"/);
  });

  test('keeps status pills low-chroma instead of primary filled button styling', () => {
    const source = readSource('src', 'components', 'ui', 'instrument.tsx');
    const statusPillStyles = source.slice(source.indexOf('const pillStyles'), source.indexOf('export function StatusPill'));

    expect(statusPillStyles).not.toContain('bg-primary text-primary-foreground');
    expect(statusPillStyles).not.toContain('bg-secondary text-secondary-foreground');
    expect(statusPillStyles).toContain('bg-primary/10');
  });
});
