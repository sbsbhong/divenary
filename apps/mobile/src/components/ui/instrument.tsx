import React from 'react';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { tva } from '@gluestack-ui/utils/nativewind-utils';
import { Box } from './box';
import { Button, ButtonIcon, ButtonSpinner, ButtonText } from './button';
import { ChevronLeftIcon } from './icon';
import { PressScaleButton } from './press-scale';
import { Text } from './text';
import type { InstrumentTone } from './theme';
import { useLoadingFeedback } from '../../hooks/use-loading-feedback';

type StatusPillProps = {
  label: string;
  tone?: InstrumentTone;
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
};

const pillStyles = tva({
  base: 'self-start overflow-hidden rounded-full px-3 py-1 text-xs font-semibold uppercase',
  variants: {
    tone: {
      primary: 'bg-primary/10 text-primary',
      secondary: 'bg-secondary/60 text-muted-foreground',
      success: 'bg-primary/10 text-primary',
      warning: 'bg-warning/10 text-warning',
      danger: 'bg-destructive/10 text-destructive',
      muted: 'bg-muted text-muted-foreground',
    },
  },
  defaultVariants: {
    tone: 'primary',
  },
});

export function StatusPill(props: StatusPillProps): React.JSX.Element {
  return (
    <Text
      testID={props.testID}
      accessibilityLabel={props.label}
      className={pillStyles({ tone: props.tone, class: props.className })}
      style={props.style}>
      {props.label.toUpperCase()}
    </Text>
  );
}

type InstrumentButtonProps = Omit<React.ComponentProps<typeof Button>, 'children' | 'className' | 'style' | 'variant'> & {
  label: string;
  icon?: React.ElementType;
  iconPlacement?: 'leading' | 'trailing';
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * The action is running: the button is disabled and busy at once and keeps its label. A
   * spinner covers the content only if the work is still running after the shared 1 s delay.
   */
  pending?: boolean;
};

const buttonStyles = tva({
  base: 'min-h-12 items-center justify-center rounded-full px-5 py-3',
  variants: {
    variant: {
      primary: 'bg-primary',
      secondary: 'bg-secondary',
      danger: 'bg-destructive/10',
    },
  },
  defaultVariants: {
    variant: 'secondary',
  },
});

const buttonTextStyles = tva({
  base: 'text-center text-base font-normal',
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      secondary: 'text-primary',
      danger: 'text-destructive',
    },
  },
  defaultVariants: {
    variant: 'secondary',
  },
});

const buttonIconStyles = tva({
  base: 'shrink-0',
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      secondary: 'text-primary',
      danger: 'text-destructive',
    },
  },
  defaultVariants: {
    variant: 'secondary',
  },
});

const instrumentButtonVariant = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'ghost',
} as const;

type ScreenBackButtonProps = Omit<React.ComponentProps<typeof Button>, 'children' | 'className' | 'style' | 'variant' | 'size'> & {
  accessibilityLabel: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

const screenBackButtonStyles = tva({
  base: 'h-11 w-11 self-start rounded-full bg-primary/10',
});

export function ScreenBackButton({
  className,
  style,
  testID,
  ...pressableProps
}: ScreenBackButtonProps): React.JSX.Element {
  return (
    <PressScaleButton
      {...pressableProps}
      kind="control"
      testID={testID}
      variant="ghost"
      size="icon"
      className={screenBackButtonStyles({ class: className })}
      style={style}>
      <Box testID={typeof testID === 'string' ? `${testID}-icon` : undefined} className="items-center justify-center">
        <ButtonIcon as={ChevronLeftIcon} className="text-primary" />
      </Box>
    </PressScaleButton>
  );
}

export function InstrumentButton({
  label,
  icon: ButtonGlyph,
  iconPlacement = 'leading',
  variant = 'secondary',
  className,
  style,
  pending = false,
  ...pressableProps
}: InstrumentButtonProps): React.JSX.Element {
  const { showIndicator } = useLoadingFeedback(pending);
  const testID = typeof pressableProps.testID === 'string' ? pressableProps.testID : undefined;
  // The content keeps its space while the spinner covers it, so the button never changes width.
  const contentStyle = showIndicator ? { opacity: 0 } : undefined;
  const icon = ButtonGlyph ? (
    <Box testID={testID ? `${testID}-icon` : undefined} className="items-center justify-center" style={contentStyle}>
      <ButtonIcon as={ButtonGlyph} className={buttonIconStyles({ variant })} />
    </Box>
  ) : null;
  const disabled = pending || Boolean(pressableProps.disabled) || Boolean(pressableProps.isDisabled);

  return (
    <PressScaleButton
      {...pressableProps}
      kind="control"
      disabled={disabled}
      accessibilityState={{ ...pressableProps.accessibilityState, busy: pending, disabled }}
      variant={instrumentButtonVariant[variant]}
      className={buttonStyles({ variant, class: className })}
      style={style}>
      {iconPlacement === 'leading' ? icon : null}
      <ButtonText className={buttonTextStyles({ variant })} style={contentStyle}>
        {label}
      </ButtonText>
      {iconPlacement === 'trailing' ? icon : null}
      {showIndicator ? (
        <Box pointerEvents="none" className="absolute inset-0 items-center justify-center">
          <ButtonSpinner testID={testID ? `${testID}-spinner` : undefined} className={buttonIconStyles({ variant })} />
        </Box>
      ) : null}
    </PressScaleButton>
  );
}

type SelectorPillProps = Omit<React.ComponentProps<typeof Button>, 'children' | 'className' | 'style' | 'variant'> & {
  label: string;
  selected: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

const selectorPillStyles = tva({
  base: 'min-h-11 items-center justify-center rounded-full px-3 py-2',
  variants: {
    selected: {
      true: 'bg-card',
      false: 'bg-transparent',
    },
  },
  defaultVariants: {
    selected: false,
  },
});

const selectorPillTextStyles = tva({
  base: 'text-xs font-semibold uppercase',
  variants: {
    selected: {
      true: 'text-foreground',
      false: 'text-muted-foreground',
    },
  },
  defaultVariants: {
    selected: false,
  },
});

export function SelectorPill({
  label,
  selected,
  className,
  style,
  ...pressableProps
}: SelectorPillProps): React.JSX.Element {
  return (
    <PressScaleButton
      {...pressableProps}
      kind="control"
      variant="ghost"
      accessibilityState={{ selected }}
      className={selectorPillStyles({ selected, class: className })}
      style={style}>
      <ButtonText className={selectorPillTextStyles({ selected })}>{label}</ButtonText>
    </PressScaleButton>
  );
}

type SafetyTextProps = {
  children: string;
};

export function SafetyText(props: SafetyTextProps): React.JSX.Element {
  return <Text className="text-center text-xs font-semibold uppercase leading-4 text-muted-foreground">{props.children}</Text>;
}
