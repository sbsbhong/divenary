import React from 'react';

import {useAppPreferences} from '../../states/app-preferences';
import {Image} from '../ui/image';

const logoSources = {
  light: require('../../assets/brand/app-logo-light.png'),
  dark: require('../../assets/brand/app-logo-dark.png'),
} as const;

type BrandLogoProps = {
  className?: string;
  testID?: string;
};

export function BrandLogo({
  className,
  testID = 'brand-logo',
}: BrandLogoProps): React.JSX.Element {
  const {resolvedTheme} = useAppPreferences();

  return (
    <Image
      testID={testID}
      source={logoSources[resolvedTheme]}
      resizeMode="contain"
      alt=""
      size="none"
      className={className}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
