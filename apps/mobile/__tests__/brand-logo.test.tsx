let mockResolvedTheme: 'light' | 'dark' = 'light';

jest.mock('../src/states/app-preferences', () => ({
  useAppPreferences: () => ({resolvedTheme: mockResolvedTheme}),
}));

import React from 'react';
import {Image as NativeImage} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {BrandLogo} from '../src/components/brand/brand-logo';

describe('BrandLogo', () => {
  test.each(['light', 'dark'] as const)(
    'uses the %s logo for the resolved theme',
    async theme => {
      mockResolvedTheme = theme;
      let renderer!: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <BrandLogo testID="brand-logo" className="h-11 w-11" />,
        );
      });

      const image = renderer.root.findByType(NativeImage);
      expect(image.props.testID).toBe('brand-logo');
      expect(image.props.source.uri).toEqual(
        theme === 'light'
          ? require('../src/assets/brand/app-logo-light.png')
          : require('../src/assets/brand/app-logo-dark.png'),
      );
      expect(image.props.alt).toBe('');
      expect(image.props.resizeMode).toBe('contain');
      expect(image.props.accessible).toBe(false);
      expect(image.props.accessibilityElementsHidden).toBe(true);
      expect(image.props.importantForAccessibility).toBe(
        'no-hide-descendants',
      );
      expect(image.props.className).toContain('h-11');
      expect(image.props.className).toContain('w-11');

      await ReactTestRenderer.act(async () => {
        renderer.unmount();
      });
    },
  );
});
