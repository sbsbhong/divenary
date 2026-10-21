import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView as RNScrollView,
} from 'react-native';
import { Box } from './box';
import { HStack } from './hstack';
import { Input, InputField } from './input';
import { Pressable } from './pressable';
import { ScrollView } from './scroll-view';
import { Text } from './text';
import {
  DEFAULT_WHEEL_HEIGHT,
  ITEM_HEIGHT,
  OPTION_EMPHASIS_ANIMATION_DURATION_MS,
  WheelOptionContent,
  WheelSelectionOverlay,
  areNumbersEqual,
  clamp,
  clampIndex,
  coreStyles,
  formatNumber,
  getClosestOptionIndex,
  getStepPrecision,
  getWheelLayout,
  getWheelRenderWindow,
  keyExtractor,
  makeNumberOptions,
  normalizeDraftValue,
  parseDraftValue,
  roundToStep,
  type NumberWheelLayout,
} from './wheel-picker-core';

export {
  DEFAULT_WHEEL_HEIGHT,
  ITEM_HEIGHT,
  OPTION_EMPHASIS_ANIMATION_DURATION_MS,
  getWheelLayout,
};
export type { NumberWheelLayout };

export type NumberWheelPickerProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  unitLabel?: string;
  disabled?: boolean;
  valueType?: 'int' | 'float';
  onBlur?: () => void;
  height?: number;
  testID?: string;
};

type NumberWheelPickerRootProps = NumberWheelPickerProps & {
  children: React.ReactNode;
};

type NumberWheelPickerState = {
  value: number;
  min: number;
  max: number;
  step: number;
  unitLabel?: string;
  disabled: boolean;
  valueType: 'int' | 'float';
  testID: string;
  layout: NumberWheelLayout;
  options: number[];
  selectedIndex: number;
  selectedValue: number;
  displayIndex: number;
  displayValue: number;
  draftValue: string;
  isEditing: boolean;
};

type NumberWheelPickerActions = {
  beginWheelInteraction: () => void;
  updateFromScrollOffset: (offsetY: number) => void;
  finishWheelScroll: (offsetY: number) => void;
  endDragWheelScroll: (offsetY: number, velocityY?: number) => void;
  openInput: () => void;
  changeDraft: (nextDraftValue: string) => void;
  commitDraft: () => void;
};

type NumberWheelPickerMeta = {
  listRef: React.RefObject<RNScrollView | null>;
  inputRef: React.RefObject<React.ComponentRef<typeof InputField> | null>;
  onBlur?: () => void;
};

type NumberWheelPickerContextValue = {
  state: NumberWheelPickerState;
  actions: NumberWheelPickerActions;
  meta: NumberWheelPickerMeta;
};

const NumberWheelPickerContext = React.createContext<NumberWheelPickerContextValue | null>(null);

function useNumberWheelPicker(componentName: string): NumberWheelPickerContextValue {
  const context = React.use(NumberWheelPickerContext);
  if (context === null) {
    throw new Error(`${componentName} must be used within NumberWheelPicker.Root`);
  }

  return context;
}

function NumberWheelPickerPreset(props: NumberWheelPickerProps): React.JSX.Element {
  return (
    <NumberWheelPickerRoot {...props}>
      <Box
        testID={`${props.testID ?? 'number-wheel-picker'}-wheel`}
        className={props.disabled ? 'overflow-hidden rounded-xl border border-border bg-muted' : 'overflow-hidden rounded-xl border border-border bg-card'}
        style={[styles.wheel, { height: getWheelLayout(props.height).wheelHeight }]}
      >
        <NumberWheelPickerWheel />
        <NumberWheelPickerSelectionOverlay />
        <NumberWheelPickerCenterInputTrigger />
      </Box>
    </NumberWheelPickerRoot>
  );
}

function NumberWheelPickerRoot({
  value,
  min,
  max,
  step = 1,
  onChange,
  unitLabel,
  disabled = false,
  valueType,
  onBlur,
  height = DEFAULT_WHEEL_HEIGHT,
  testID = 'number-wheel-picker',
  children,
}: NumberWheelPickerRootProps): React.JSX.Element {
  const { t } = useTranslation();
  const listRef = React.useRef<RNScrollView>(null);
  const inputRef = React.useRef<React.ComponentRef<typeof InputField>>(null);
  const safeStep = step > 0 ? step : 1;
  const options = React.useMemo(() => makeNumberOptions(min, max, safeStep), [max, min, safeStep]);
  const selectedIndex = React.useMemo(() => getClosestOptionIndex(options, value), [options, value]);
  const selectedValue = options[selectedIndex] ?? clamp(roundToStep(value, safeStep), min, max);
  const inputValueType = valueType ?? (getStepPrecision(safeStep) > 0 ? 'float' : 'int');
  const layout = React.useMemo(() => getWheelLayout(height), [height]);
  const [displayIndex, setDisplayIndex] = React.useState(selectedIndex);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftValue, setDraftValue] = React.useState(() => formatNumber(selectedValue, safeStep));
  const displayIndexRef = React.useRef(selectedIndex);
  const isWheelInteractingRef = React.useRef(false);
  const lastEmittedValueRef = React.useRef(selectedValue);
  const displayValue = options[displayIndex] ?? selectedValue;

  React.useEffect(() => {
    if (!isEditing) {
      setDraftValue(formatNumber(displayValue, safeStep));
    }
  }, [displayValue, isEditing, safeStep]);

  React.useEffect(() => {
    const nextIndex = clampIndex(selectedIndex, options.length);
    displayIndexRef.current = nextIndex;
    lastEmittedValueRef.current = selectedValue;
    setDisplayIndex(nextIndex);

    if (!isWheelInteractingRef.current) {
      listRef.current?.scrollTo({ y: nextIndex * ITEM_HEIGHT, animated: false });
    }
  }, [options.length, selectedIndex, selectedValue]);

  const selectIndex = React.useCallback(
    (nextIndex: number, shouldEmit: boolean) => {
      const clampedIndex = clampIndex(nextIndex, options.length);
      const nextValue = options[clampedIndex];
      if (nextValue === undefined) {
        return;
      }

      if (clampedIndex !== displayIndexRef.current) {
        displayIndexRef.current = clampedIndex;
        setDisplayIndex(clampedIndex);
      }

      if (shouldEmit && !areNumbersEqual(nextValue, lastEmittedValueRef.current)) {
        lastEmittedValueRef.current = nextValue;
        onChange(nextValue);
      }
    },
    [onChange, options],
  );

  const updateFromScrollOffset = React.useCallback(
    (offsetY: number) => {
      if (options.length === 0) {
        return;
      }

      selectIndex(Math.round(offsetY / ITEM_HEIGHT), true);
    },
    [options.length, selectIndex],
  );

  const beginWheelInteraction = React.useCallback(() => {
    if (disabled) {
      return;
    }

    isWheelInteractingRef.current = true;
  }, [disabled]);

  const finishWheelScroll = React.useCallback(
    (offsetY: number) => {
      if (disabled || isEditing) {
        return;
      }

      updateFromScrollOffset(offsetY);
      isWheelInteractingRef.current = false;
    },
    [disabled, isEditing, updateFromScrollOffset],
  );

  const endDragWheelScroll = React.useCallback(
    (offsetY: number, velocityY = 0) => {
      if (disabled || isEditing) {
        return;
      }

      updateFromScrollOffset(offsetY);
      if (Math.abs(velocityY) < 0.05) {
        isWheelInteractingRef.current = false;
      }
    },
    [disabled, isEditing, updateFromScrollOffset],
  );

  const changeDraft = React.useCallback(
    (nextDraftValue: string) => {
      setDraftValue(normalizeDraftValue(nextDraftValue, inputValueType));
    },
    [inputValueType],
  );

  const openInput = React.useCallback(() => {
    if (disabled) {
      return;
    }

    setDraftValue(formatNumber(displayValue, safeStep));
    setIsEditing(true);
    setTimeout(() => {
      (inputRef.current as unknown as { focus?: () => void } | null)?.focus?.();
    }, 0);
  }, [disabled, displayValue, safeStep]);

  const commitDraft = React.useCallback(() => {
    const parsedValue = parseDraftValue(draftValue);
    setIsEditing(false);
    Keyboard.dismiss();
    onBlur?.();

    if (parsedValue === undefined) {
      setDraftValue(formatNumber(displayValue, safeStep));
      return;
    }

    const clampedDraftValue = clamp(parsedValue, min, max);
    const nextValue = clamp(roundToStep(clampedDraftValue, safeStep), min, max);
    const nextIndex = getClosestOptionIndex(options, nextValue);
    setDraftValue(formatNumber(nextValue, safeStep));
    selectIndex(nextIndex, !areNumbersEqual(nextValue, value));
    listRef.current?.scrollTo({ y: nextIndex * ITEM_HEIGHT, animated: false });
  }, [displayValue, draftValue, max, min, onBlur, options, safeStep, selectIndex, value]);

  const contextValue = React.useMemo<NumberWheelPickerContextValue>(
    () => ({
      state: {
        value,
        min,
        max,
        step: safeStep,
        unitLabel,
        disabled,
        valueType: inputValueType,
        testID,
        layout,
        options,
        selectedIndex,
        selectedValue,
        displayIndex,
        displayValue,
        draftValue,
        isEditing,
      },
      actions: {
        beginWheelInteraction,
        updateFromScrollOffset,
        finishWheelScroll,
        endDragWheelScroll,
        openInput,
        changeDraft,
        commitDraft,
      },
      meta: {
        listRef,
        inputRef,
        onBlur,
      },
    }),
    [
      beginWheelInteraction,
      changeDraft,
      commitDraft,
      disabled,
      displayIndex,
      displayValue,
      draftValue,
      endDragWheelScroll,
      finishWheelScroll,
      inputValueType,
      isEditing,
      layout,
      max,
      min,
      onBlur,
      openInput,
      options,
      safeStep,
      selectedIndex,
      selectedValue,
      testID,
      unitLabel,
      updateFromScrollOffset,
      value,
    ],
  );

  const stepByAccessibilityAction = React.useCallback(
    (actionName: string) => {
      if (disabled) {
        return;
      }
      const delta = actionName === 'increment' ? 1 : actionName === 'decrement' ? -1 : 0;
      if (delta === 0) {
        return;
      }
      const nextIndex = clampIndex(displayIndexRef.current + delta, options.length);
      selectIndex(nextIndex, true);
      listRef.current?.scrollTo({ y: nextIndex * ITEM_HEIGHT, animated: false });
    },
    [disabled, options.length, selectIndex],
  );

  return (
    <NumberWheelPickerContext.Provider value={contextValue}>
      <Box
        testID={testID}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={unitLabel ? t('wheelPicker.labelWithUnit', { unit: unitLabel }) : t('wheelPicker.label')}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => stepByAccessibilityAction(event.nativeEvent.actionName)}
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min,
          max,
          now: displayValue,
          text: unitLabel ? `${formatNumber(displayValue, safeStep)} ${unitLabel}` : formatNumber(displayValue, safeStep),
        }}
      >
        {children}
      </Box>
    </NumberWheelPickerContext.Provider>
  );
}

function NumberWheelPickerWheel(): React.JSX.Element {
  const {
    state: { disabled, isEditing, layout, options, displayIndex, testID },
    actions: { beginWheelInteraction, endDragWheelScroll, finishWheelScroll, updateFromScrollOffset },
    meta: { listRef },
  } = useNumberWheelPicker('NumberWheelPicker.Wheel');
  const renderWindow = React.useMemo(
    () => getWheelRenderWindow(options.length, displayIndex, layout.visibleItemCount),
    [displayIndex, layout.visibleItemCount, options.length],
  );
  const visibleOptions = React.useMemo(
    () => options.slice(renderWindow.startIndex, renderWindow.endIndex + 1),
    [options, renderWindow.endIndex, renderWindow.startIndex],
  );

  return (
    <ScrollView
      ref={listRef}
      testID={`${testID}-wheel-list`}
      contentOffset={{ x: 0, y: displayIndex * ITEM_HEIGHT }}
      onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (!disabled && !isEditing) {
          updateFromScrollOffset(event.nativeEvent.contentOffset.y);
        }
      }}
      onScrollBeginDrag={beginWheelInteraction}
      onMomentumScrollBegin={beginWheelInteraction}
      onScrollEndDrag={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        endDragWheelScroll(event.nativeEvent.contentOffset.y, event.nativeEvent.velocity?.y);
      }}
      onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        finishWheelScroll(event.nativeEvent.contentOffset.y);
      }}
      snapToInterval={ITEM_HEIGHT}
      snapToAlignment="start"
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      scrollEnabled={!disabled && !isEditing}
      nestedScrollEnabled
      bounces={false}
      scrollEventThrottle={16}
      style={[styles.scroller, { height: layout.wheelHeight }]}
      contentContainerStyle={[styles.contentContainer, { paddingVertical: layout.centerPadding }]}
    >
      {renderWindow.topSpacerHeight > 0 ? (
        <Box testID={`${testID}-top-spacer`} style={{ height: renderWindow.topSpacerHeight }} />
      ) : null}
      {visibleOptions.map((option, offset) => (
        <NumberWheelPickerOption key={keyExtractor(option)} value={option} index={renderWindow.startIndex + offset} />
      ))}
      {renderWindow.bottomSpacerHeight > 0 ? (
        <Box testID={`${testID}-bottom-spacer`} style={{ height: renderWindow.bottomSpacerHeight }} />
      ) : null}
    </ScrollView>
  );
}

type NumberWheelPickerOptionProps = {
  value: number;
  index: number;
};

function NumberWheelPickerOption({ value, index }: NumberWheelPickerOptionProps): React.JSX.Element {
  const {
    state: { displayIndex, step, testID, unitLabel },
  } = useNumberWheelPicker('NumberWheelPicker.Option');
  const distanceFromCenter = Math.abs(index - displayIndex);
  const formattedValue = formatNumber(value, step);

  return (
    <WheelOptionContent
      testIDPrefix={`${testID}-option-${formattedValue}`}
      valueText={formattedValue}
      unitLabel={unitLabel}
      distanceFromCenter={distanceFromCenter}
      hideWhenCentered
    />
  );
}

function NumberWheelPickerSelectionOverlay(): React.JSX.Element {
  const {
    state: { disabled, layout },
  } = useNumberWheelPicker('NumberWheelPicker.SelectionOverlay');

  return <WheelSelectionOverlay disabled={disabled} layout={layout} />;
}

function NumberWheelPickerCenterInputTrigger(): React.JSX.Element {
  const {
    state: { disabled, displayValue, draftValue, isEditing, layout, step, testID, unitLabel, valueType },
    actions: { changeDraft, commitDraft, openInput },
    meta: { inputRef },
  } = useNumberWheelPicker('NumberWheelPicker.CenterInputTrigger');
  const { t } = useTranslation();
  const valueColumnStyle = unitLabel ? styles.valueColumn : styles.singleValueColumn;
  const valueColumnClassName = unitLabel ? 'items-end justify-center' : 'items-center justify-center';
  const valueTextClassName = unitLabel ? 'text-2xl font-semibold text-foreground' : 'text-center text-2xl font-semibold text-foreground';
  const inputTextClassName = unitLabel ? 'text-right text-2xl font-semibold text-foreground' : 'text-center text-2xl font-semibold text-foreground';

  return (
    <Pressable
      testID={`${testID}-input-trigger`}
      accessibilityRole="button"
      accessibilityLabel={t('wheelPicker.enterNumber')}
      disabled={disabled}
      onPress={openInput}
      style={[styles.centerInputTrigger, { top: layout.centerPadding }]}
      className="self-center px-2 data-[active=true]:bg-primary/10"
    >
      {isEditing ? (
        <HStack testID={`${testID}-center-row`} className="w-full items-center justify-center">
          <Box testID={`${testID}-center-value-column`} style={valueColumnStyle} className={valueColumnClassName}>
            <Input className="h-10 w-full rounded-none border-0 bg-transparent px-0 shadow-none">
              <InputField
                ref={inputRef}
                testID={`${testID}-input`}
                value={draftValue}
                onChangeText={changeDraft}
                onSubmitEditing={commitDraft}
                onBlur={commitDraft}
                keyboardType={valueType === 'float' ? 'decimal-pad' : 'number-pad'}
                returnKeyType="done"
                selectTextOnFocus
                autoFocus
                editable={!disabled}
                className={inputTextClassName}
              />
            </Input>
          </Box>
          {unitLabel ? (
            <Box testID={`${testID}-center-unit-column`} style={styles.unitColumn} className="items-start justify-center">
              <Text testID={`${testID}-unit`} className="text-sm font-semibold text-foreground">
                {unitLabel}
              </Text>
            </Box>
          ) : null}
        </HStack>
      ) : (
        <HStack testID={`${testID}-center-row`} className="w-full items-baseline justify-center">
          <Box testID={`${testID}-center-value-column`} style={valueColumnStyle} className={valueColumnClassName}>
            <Text
              testID={`${testID}-value`}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              className={valueTextClassName}
            >
              {formatNumber(displayValue, step)}
            </Text>
          </Box>
          {unitLabel ? (
            <Box testID={`${testID}-center-unit-column`} style={styles.unitColumn} className="items-start justify-center">
              <Text testID={`${testID}-unit`} className="text-sm font-semibold text-foreground">
                {unitLabel}
              </Text>
            </Box>
          ) : null}
        </HStack>
      )}
    </Pressable>
  );
}

export const NumberWheelPicker = Object.assign(NumberWheelPickerPreset, {
  Root: NumberWheelPickerRoot,
  Wheel: NumberWheelPickerWheel,
  SelectionOverlay: NumberWheelPickerSelectionOverlay,
  CenterInputTrigger: NumberWheelPickerCenterInputTrigger,
});

const styles = StyleSheet.create({
  centerInputTrigger: {
    height: ITEM_HEIGHT,
    left: 8,
    position: 'absolute',
    right: 8,
  },
  contentContainer: {},
  scroller: {},
  singleValueColumn: {
    flex: 1,
    paddingRight: 0,
  },
  unitColumn: coreStyles.unitColumn,
  valueColumn: coreStyles.valueColumn,
  wheel: {},
});
