import React from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Box } from './box';
import { Text } from './text';

export const ITEM_HEIGHT = 36;
export const DEFAULT_WHEEL_HEIGHT = 176;
export const OPTION_EMPHASIS_ANIMATION_DURATION_MS = 90;

const MIN_VISIBLE_ITEM_COUNT = 3;
const MIN_WHEEL_HEIGHT = ITEM_HEIGHT * MIN_VISIBLE_ITEM_COUNT;
const WINDOW_BUFFER_ITEM_COUNT = 6;

export type NumberWheelLayout = {
  wheelHeight: number;
  visibleItemCount: number;
  centerPadding: number;
};

export type WheelRenderWindow = {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
};

type OptionPresentation = {
  valueClassName: string;
  unitClassName: string;
  scale: number;
  opacity: number;
};

export function getWheelLayout(height = DEFAULT_WHEEL_HEIGHT): NumberWheelLayout {
  const requestedHeight = Number.isFinite(height) ? height : DEFAULT_WHEEL_HEIGHT;
  const wheelHeight = Math.max(MIN_WHEEL_HEIGHT, Math.round(requestedHeight));
  const approximateCount = Math.max(MIN_VISIBLE_ITEM_COUNT, wheelHeight / ITEM_HEIGHT);
  const visibleItemCount = toOddVisibleItemCount(approximateCount);

  return {
    wheelHeight,
    visibleItemCount,
    centerPadding: (wheelHeight - ITEM_HEIGHT) / 2,
  };
}

function toOddVisibleItemCount(value: number): number {
  const count = Math.max(MIN_VISIBLE_ITEM_COUNT, value);
  const floor = Math.floor(count);
  const ceiling = Math.ceil(count);
  const lowerOdd = Math.max(MIN_VISIBLE_ITEM_COUNT, floor % 2 === 1 ? floor : floor - 1);
  const upperOdd = Math.max(MIN_VISIBLE_ITEM_COUNT, ceiling % 2 === 1 ? ceiling : ceiling + 1);

  return count - lowerOdd <= upperOdd - count ? lowerOdd : upperOdd;
}

export function makeNumberOptions(min: number, max: number, step: number): number[] {
  const safeStep = step > 0 ? step : 1;
  const precision = getStepPrecision(safeStep);
  const count = Math.floor((max - min) / safeStep);
  const options: number[] = [];

  for (let index = 0; index <= count; index += 1) {
    options.push(Number((min + safeStep * index).toFixed(precision)));
  }

  const roundedMax = Number(max.toFixed(precision));
  if (!areNumbersEqual(options[options.length - 1] ?? min, roundedMax)) {
    options.push(roundedMax);
  }

  return options;
}

export function keyExtractor(value: number): string {
  return `${value}`;
}

export function getWheelRenderWindow(optionsLength: number, displayIndex: number, visibleItemCount: number): WheelRenderWindow {
  if (optionsLength <= 0) {
    return {
      startIndex: 0,
      endIndex: -1,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  const radius = Math.ceil(visibleItemCount / 2) + WINDOW_BUFFER_ITEM_COUNT;
  const startIndex = Math.max(0, displayIndex - radius);
  const endIndex = Math.min(optionsLength - 1, displayIndex + radius);

  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * ITEM_HEIGHT,
    bottomSpacerHeight: (optionsLength - endIndex - 1) * ITEM_HEIGHT,
  };
}

function getOptionPresentation(distanceFromCenter: number): OptionPresentation {
  if (distanceFromCenter === 0) {
    return {
      valueClassName: 'text-xl font-semibold text-foreground',
      unitClassName: 'text-sm font-semibold text-foreground',
      scale: 1,
      opacity: 1,
    };
  }

  if (distanceFromCenter === 1) {
    return {
      valueClassName: 'text-lg font-semibold text-muted-foreground',
      unitClassName: 'text-sm font-semibold text-muted-foreground',
      scale: 1.06,
      opacity: 0.72,
    };
  }

  if (distanceFromCenter === 2) {
    return {
      valueClassName: 'text-base font-medium text-muted-foreground/60',
      unitClassName: 'text-xs font-semibold text-muted-foreground/60',
      scale: 0.98,
      opacity: 0.42,
    };
  }

  return {
    valueClassName: 'text-sm font-medium text-muted-foreground/40',
    unitClassName: 'text-xs font-semibold text-muted-foreground/40',
    scale: 0.94,
    opacity: 0.24,
  };
}

export function getClosestOptionIndex(options: readonly number[], value: number): number {
  if (options.length === 0) {
    return 0;
  }

  let closestIndex = 0;
  let closestDistance = Math.abs(options[0] - value);
  for (let index = 1; index < options.length; index += 1) {
    const distance = Math.abs(options[index] - value);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
}

export function normalizeDraftValue(value: string, valueType: 'int' | 'float'): string {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '');
  if (valueType === 'int') {
    return normalized.replace(/\./g, '');
  }

  const [wholePart, ...decimalParts] = normalized.split('.');
  if (decimalParts.length === 0) {
    return wholePart;
  }

  return `${wholePart}.${decimalParts.join('')}`;
}

export function parseDraftValue(value: string): number | undefined {
  if (value.trim().length === 0 || value === '.') {
    return undefined;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(length - 1, value));
}

export function roundToStep(value: number, step: number): number {
  if (step <= 0) {
    return value;
  }

  const precision = getStepPrecision(step);
  return Number((Math.round(value / step) * step).toFixed(precision));
}

export function formatNumber(value: number, step: number): string {
  const precision = getStepPrecision(step);
  return value.toFixed(precision).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function getStepPrecision(step: number): number {
  const decimalPart = `${step}`.split('.')[1];
  return decimalPart?.length ?? 0;
}

export function areNumbersEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

export function WheelSelectionOverlay(props: {
  disabled?: boolean;
  layout: NumberWheelLayout;
  testID?: string;
}): React.JSX.Element {
  const shadeClassName = props.disabled ? 'bg-muted/80' : 'bg-card/80';
  const frameClassName = props.disabled ? 'border-y border-border bg-muted/40' : 'border-y border-border bg-muted/30';

  return (
    <>
      <Box pointerEvents="none" style={[coreStyles.topShade, { height: props.layout.centerPadding }]} className={shadeClassName} />
      <Box pointerEvents="none" style={[coreStyles.bottomShade, { height: props.layout.centerPadding }]} className={shadeClassName} />
      <Box
        testID={props.testID}
        pointerEvents="none"
        style={[coreStyles.selectionFrame, { top: props.layout.centerPadding }]}
        className={frameClassName}
      />
    </>
  );
}

export function WheelOptionContent(props: {
  testIDPrefix: string;
  valueText: string;
  unitLabel?: string;
  distanceFromCenter: number;
  hideWhenCentered?: boolean;
  valueColumnStyle?: StyleProp<ViewStyle>;
  unitColumnStyle?: StyleProp<ViewStyle>;
  valueClassName?: string;
  unitClassName?: string;
}): React.JSX.Element {
  const presentation = getOptionPresentation(props.distanceFromCenter);
  const scale = React.useRef(new Animated.Value(presentation.scale)).current;
  const opacity = React.useRef(new Animated.Value(presentation.opacity)).current;
  const hasMountedRef = React.useRef(false);
  const centerHiddenClassName = props.hideWhenCentered && props.distanceFromCenter === 0 ? ' opacity-0' : '';
  const valueColumnClassName = props.unitLabel ? 'items-end justify-center' : 'items-center justify-center';
  const valueColumnStyle = props.unitLabel ? coreStyles.valueColumn : coreStyles.singleValueColumn;

  React.useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    Animated.parallel([
      Animated.timing(scale, {
        toValue: presentation.scale,
        duration: OPTION_EMPHASIS_ANIMATION_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: presentation.opacity,
        duration: OPTION_EMPHASIS_ANIMATION_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, presentation.opacity, presentation.scale, scale]);

  return (
    <Animated.View
      testID={`${props.testIDPrefix}-content`}
      style={[coreStyles.item, coreStyles.optionContent, { opacity, transform: [{ scale }] }]}
    >
      <Box testID={`${props.testIDPrefix}-value-column`} style={[valueColumnStyle, props.valueColumnStyle]} className={valueColumnClassName}>
        <Text
          testID={`${props.testIDPrefix}-value`}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          className={`${props.valueClassName ?? presentation.valueClassName}${centerHiddenClassName}`}
        >
          {props.valueText}
        </Text>
      </Box>
      {props.unitLabel ? (
        <Box testID={`${props.testIDPrefix}-unit-column`} style={[coreStyles.unitColumn, props.unitColumnStyle]} className="items-start justify-center">
          <Text
            testID={`${props.testIDPrefix}-unit`}
            numberOfLines={1}
            className={`${props.unitClassName ?? presentation.unitClassName}${centerHiddenClassName}`}
          >
            {props.unitLabel}
          </Text>
        </Box>
      ) : null}
    </Animated.View>
  );
}

export const coreStyles = StyleSheet.create({
  bottomShade: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  item: {
    height: ITEM_HEIGHT,
  },
  optionContent: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
  },
  selectionFrame: {
    height: ITEM_HEIGHT,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  topShade: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  unitColumn: {
    width: 52,
  },
  singleValueColumn: {
    flex: 1,
    paddingRight: 0,
  },
  valueColumn: {
    flex: 1,
    paddingRight: 6,
  },
});
