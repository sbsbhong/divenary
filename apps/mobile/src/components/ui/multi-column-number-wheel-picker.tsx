import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  StyleSheet,
  type KeyboardTypeOptions,
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
  WheelOptionContent,
  WheelSelectionOverlay,
  areNumbersEqual,
  clampIndex,
  formatNumber,
  getClosestOptionIndex,
  getWheelLayout,
  getWheelRenderWindow,
  keyExtractor,
  makeNumberOptions,
  type NumberWheelLayout,
} from './wheel-picker-core';

export type MultiColumnNumberWheelScrollableColumn = {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unitLabel?: string;
  padStart?: number;
  formatValue?: (value: number) => string;
  width?: number;
};

export type MultiColumnNumberWheelFixedColumn = {
  id: string;
  fixedLabel: string;
  width?: number;
};

export type MultiColumnNumberWheelColumn =
  | MultiColumnNumberWheelScrollableColumn
  | MultiColumnNumberWheelFixedColumn;

export type MultiColumnNumberWheelDirectInput = {
  value: string;
  normalize: (value: string) => string;
  onCommit: (value: string) => boolean;
  keyboardType?: KeyboardTypeOptions;
  accessibilityLabel?: string;
};

export type MultiColumnNumberWheelPickerProps = {
  columns: MultiColumnNumberWheelColumn[];
  onColumnChange: (columnId: string, value: number) => void;
  directInput: MultiColumnNumberWheelDirectInput;
  height?: number;
  disabled?: boolean;
  testID?: string;
};

function isScrollableColumn(column: MultiColumnNumberWheelColumn): column is MultiColumnNumberWheelScrollableColumn {
  return 'value' in column;
}

function formatColumnValue(column: MultiColumnNumberWheelScrollableColumn, value: number): string {
  const formatted = column.formatValue ? column.formatValue(value) : formatNumber(value, column.step ?? 1);
  return column.padStart === undefined ? formatted : formatted.padStart(column.padStart, '0');
}

export function MultiColumnNumberWheelPicker({
  columns,
  onColumnChange,
  directInput,
  height = DEFAULT_WHEEL_HEIGHT,
  disabled = false,
  testID = 'multi-column-number-wheel-picker',
}: MultiColumnNumberWheelPickerProps): React.JSX.Element {
  const layout = React.useMemo(() => getWheelLayout(height), [height]);
  const scrollableColumns = React.useMemo(() => columns.filter(isScrollableColumn), [columns]);
  const [displayIndexes, setDisplayIndexes] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(scrollableColumns.map(column => [column.id, getColumnIndex(column)])),
  );
  const scrollableColumnSignature = scrollableColumns
    .map(column => `${column.id}:${column.value}:${column.min}:${column.max}:${column.step ?? 1}`)
    .join('|');
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftValue, setDraftValue] = React.useState(directInput.value);
  const listRefs = React.useRef<Record<string, RNScrollView | null>>({});
  const displayIndexesRef = React.useRef(displayIndexes);
  const lastEmittedValuesRef = React.useRef<Record<string, number>>(
    Object.fromEntries(scrollableColumns.map(column => [column.id, column.value])),
  );
  const interactingColumnsRef = React.useRef<Record<string, boolean>>({});
  const inputRef = React.useRef<React.ComponentRef<typeof InputField>>(null);

  React.useEffect(() => {
    if (!isEditing) {
      setDraftValue(directInput.value);
    }
  }, [directInput.value, isEditing]);

  React.useEffect(() => {
    const nextIndexes = Object.fromEntries(scrollableColumns.map(column => [column.id, getColumnIndex(column)]));
    lastEmittedValuesRef.current = Object.fromEntries(scrollableColumns.map(column => [column.id, column.value]));
    displayIndexesRef.current = nextIndexes;
    setDisplayIndexes(nextIndexes);

    for (const column of scrollableColumns) {
      if (!interactingColumnsRef.current[column.id]) {
        listRefs.current[column.id]?.scrollTo({ y: nextIndexes[column.id] * ITEM_HEIGHT, animated: false });
      }
    }
  }, [scrollableColumnSignature, scrollableColumns]);

  const setColumnDisplayIndex = React.useCallback(
    (column: MultiColumnNumberWheelScrollableColumn, nextIndex: number, shouldEmit: boolean) => {
      const options = makeNumberOptions(column.min, column.max, column.step ?? 1);
      const clampedIndex = clampIndex(nextIndex, options.length);
      const nextValue = options[clampedIndex];
      if (nextValue === undefined) {
        return;
      }

      if (displayIndexesRef.current[column.id] !== clampedIndex) {
        displayIndexesRef.current = {
          ...displayIndexesRef.current,
          [column.id]: clampedIndex,
        };
        setDisplayIndexes(displayIndexesRef.current);
      }

      if (shouldEmit && !areNumbersEqual(nextValue, lastEmittedValuesRef.current[column.id] ?? column.value)) {
        lastEmittedValuesRef.current = {
          ...lastEmittedValuesRef.current,
          [column.id]: nextValue,
        };
        onColumnChange(column.id, nextValue);
      }
    },
    [onColumnChange],
  );

  const openInput = React.useCallback(() => {
    if (disabled) {
      return;
    }

    setDraftValue(directInput.value);
    setIsEditing(true);
    setTimeout(() => {
      (inputRef.current as unknown as { focus?: () => void } | null)?.focus?.();
    }, 0);
  }, [directInput.value, disabled]);

  const commitDraft = React.useCallback(() => {
    setIsEditing(false);
    Keyboard.dismiss();
    const didCommit = directInput.onCommit(draftValue);
    if (!didCommit) {
      setDraftValue(directInput.value);
    }
  }, [directInput, draftValue]);

  const displayColumns = React.useMemo(
    () =>
      columns.map(column => {
        if (!isScrollableColumn(column)) {
          return column;
        }

        return {
          ...column,
          value: getColumnValueAtIndex(column, displayIndexes[column.id] ?? getColumnIndex(column)),
        };
      }),
    [columns, displayIndexes],
  );

  return (
    <Box testID={testID} accessibilityRole="adjustable" accessibilityState={{ disabled }}>
      <Box
        testID={`${testID}-wheel`}
        className={disabled ? 'overflow-hidden rounded-xl bg-muted' : 'overflow-hidden rounded-xl bg-card'}
        style={[styles.wheel, { height: layout.wheelHeight }]}
      >
        <HStack className="h-full w-full items-stretch justify-center">
          {columns.map(column =>
            isScrollableColumn(column) ? (
              <MultiColumnWheelColumn
                key={column.id}
                column={column}
                layout={layout}
                disabled={disabled || isEditing}
                displayIndex={displayIndexes[column.id] ?? getColumnIndex(column)}
                setListRef={ref => {
                  listRefs.current[column.id] = ref;
                }}
                onBegin={() => {
                  interactingColumnsRef.current[column.id] = true;
                }}
                onEnd={() => {
                  interactingColumnsRef.current[column.id] = false;
                }}
                onScrollIndex={(nextIndex, shouldEmit) => setColumnDisplayIndex(column, nextIndex, shouldEmit)}
                testID={`${testID}-column-${column.id}`}
              />
            ) : (
              <Box
                key={column.id}
                testID={`${testID}-column-${column.id}`}
                style={column.width === undefined ? styles.fixedColumn : { width: column.width }}
              />
            ),
          )}
        </HStack>
        <WheelSelectionOverlay disabled={disabled} layout={layout} testID={`${testID}-selection-frame`} />
        <MultiColumnCenterInputTrigger
          columns={displayColumns}
          disabled={disabled}
          isEditing={isEditing}
          layout={layout}
          draftValue={draftValue}
          directInput={directInput}
          inputRef={inputRef}
          onOpen={openInput}
          onChangeDraft={value => setDraftValue(directInput.normalize(value))}
          onCommit={commitDraft}
          testID={testID}
        />
      </Box>
    </Box>
  );
}

function getColumnIndex(column: MultiColumnNumberWheelScrollableColumn): number {
  return getClosestOptionIndex(makeNumberOptions(column.min, column.max, column.step ?? 1), column.value);
}

function getColumnValueAtIndex(column: MultiColumnNumberWheelScrollableColumn, index: number): number {
  const options = makeNumberOptions(column.min, column.max, column.step ?? 1);
  const clampedIndex = clampIndex(index, options.length);
  return options[clampedIndex] ?? column.value;
}

function MultiColumnWheelColumn(props: {
  column: MultiColumnNumberWheelScrollableColumn;
  layout: NumberWheelLayout;
  disabled: boolean;
  displayIndex: number;
  setListRef: (ref: RNScrollView | null) => void;
  onBegin: () => void;
  onEnd: () => void;
  onScrollIndex: (index: number, shouldEmit: boolean) => void;
  testID: string;
}): React.JSX.Element {
  const step = props.column.step ?? 1;
  const options = React.useMemo(() => makeNumberOptions(props.column.min, props.column.max, step), [props.column.max, props.column.min, step]);
  const renderWindow = React.useMemo(
    () => getWheelRenderWindow(options.length, props.displayIndex, props.layout.visibleItemCount),
    [options.length, props.displayIndex, props.layout.visibleItemCount],
  );
  const visibleOptions = React.useMemo(
    () => options.slice(renderWindow.startIndex, renderWindow.endIndex + 1),
    [options, renderWindow.endIndex, renderWindow.startIndex],
  );

  return (
    <ScrollView
      ref={props.setListRef}
      testID={`${props.testID}-wheel-list`}
      contentOffset={{ x: 0, y: props.displayIndex * ITEM_HEIGHT }}
      onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (!props.disabled) {
          props.onScrollIndex(Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT), true);
        }
      }}
      onScrollBeginDrag={props.onBegin}
      onMomentumScrollBegin={props.onBegin}
      onScrollEndDrag={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        props.onScrollIndex(Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT), true);
        if (Math.abs(event.nativeEvent.velocity?.y ?? 0) < 0.05) {
          props.onEnd();
        }
      }}
      onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        props.onScrollIndex(Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT), true);
        props.onEnd();
      }}
      snapToInterval={ITEM_HEIGHT}
      snapToAlignment="start"
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      scrollEnabled={!props.disabled}
      nestedScrollEnabled
      bounces={false}
      scrollEventThrottle={16}
      style={[
        props.column.width === undefined ? styles.scroller : styles.fixedWidthScroller,
        props.column.width === undefined ? null : { width: props.column.width },
        { height: props.layout.wheelHeight },
      ]}
      contentContainerStyle={[styles.contentContainer, { paddingVertical: props.layout.centerPadding }]}
    >
      {renderWindow.topSpacerHeight > 0 ? <Box testID={`${props.testID}-top-spacer`} style={{ height: renderWindow.topSpacerHeight }} /> : null}
      {visibleOptions.map((option, offset) => {
        const index = renderWindow.startIndex + offset;
        const valueText = formatColumnValue(props.column, option);

        return (
          <WheelOptionContent
            key={keyExtractor(option)}
            testIDPrefix={`${props.testID}-option-${valueText}`}
            valueText={valueText}
            unitLabel={props.column.unitLabel}
            distanceFromCenter={Math.abs(index - props.displayIndex)}
            hideWhenCentered
          />
        );
      })}
      {renderWindow.bottomSpacerHeight > 0 ? <Box testID={`${props.testID}-bottom-spacer`} style={{ height: renderWindow.bottomSpacerHeight }} /> : null}
    </ScrollView>
  );
}

function MultiColumnCenterInputTrigger(props: {
  columns: MultiColumnNumberWheelColumn[];
  disabled: boolean;
  isEditing: boolean;
  layout: NumberWheelLayout;
  draftValue: string;
  directInput: MultiColumnNumberWheelDirectInput;
  inputRef: React.RefObject<React.ComponentRef<typeof InputField> | null>;
  onOpen: () => void;
  onChangeDraft: (value: string) => void;
  onCommit: () => void;
  testID: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Pressable
      testID={`${props.testID}-input-trigger`}
      accessibilityRole="button"
      accessibilityLabel={props.directInput.accessibilityLabel ?? t('wheelPicker.enterNumber')}
      disabled={props.disabled}
      onPress={props.onOpen}
      style={[styles.centerInputTrigger, { top: props.layout.centerPadding }]}
      className="self-center px-2 data-[active=true]:bg-primary/10"
    >
      {props.isEditing ? (
        <HStack testID={`${props.testID}-center-row`} className="w-full items-center justify-center">
          <Input className="h-10 w-full rounded-none border-0 bg-transparent px-0 shadow-none">
            <InputField
              ref={props.inputRef}
              testID={`${props.testID}-input`}
              aria-label={props.directInput.accessibilityLabel ?? t('wheelPicker.enterNumber')}
              value={props.draftValue}
              onChangeText={props.onChangeDraft}
              onSubmitEditing={props.onCommit}
              onBlur={props.onCommit}
              keyboardType={props.directInput.keyboardType ?? 'numbers-and-punctuation'}
              returnKeyType="done"
              selectTextOnFocus
              autoFocus
              editable={!props.disabled}
              className="text-center text-2xl font-semibold text-foreground"
            />
          </Input>
        </HStack>
      ) : (
        <HStack testID={`${props.testID}-center-row`} className="w-full items-baseline justify-center">
          {props.columns.map(column =>
            isScrollableColumn(column) ? (
              <CenterScrollableColumn key={column.id} column={column} testID={props.testID} />
            ) : (
              <Box
                key={column.id}
                style={column.width === undefined ? styles.fixedCenterColumn : { width: column.width }}
                className="items-start justify-center"
              >
                <Text testID={`${props.testID}-${column.id}-fixed`} className="text-sm font-semibold text-foreground">
                  {column.fixedLabel}
                </Text>
              </Box>
            ),
          )}
        </HStack>
      )}
    </Pressable>
  );
}

function CenterScrollableColumn(props: {
  column: MultiColumnNumberWheelScrollableColumn;
  testID: string;
}): React.JSX.Element {
  return (
    <HStack
      testID={`${props.testID}-${props.column.id}-center-column`}
      style={props.column.width === undefined ? styles.centerColumn : { width: props.column.width }}
      className="items-baseline justify-center"
    >
      <Text
        testID={`${props.testID}-${props.column.id}-value`}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        className="text-2xl font-semibold text-foreground"
      >
        {formatColumnValue(props.column, props.column.value)}
      </Text>
      {props.column.unitLabel ? (
        <Text testID={`${props.testID}-${props.column.id}-unit`} className="ml-1 text-sm font-semibold text-foreground">
          {props.column.unitLabel}
        </Text>
      ) : null}
    </HStack>
  );
}

const styles = StyleSheet.create({
  centerColumn: {
    minWidth: 84,
  },
  centerInputTrigger: {
    height: ITEM_HEIGHT,
    left: 8,
    position: 'absolute',
    right: 8,
  },
  contentContainer: {},
  fixedCenterColumn: {
    minWidth: 28,
  },
  fixedColumn: {
    minWidth: 28,
  },
  fixedWidthScroller: {},
  scroller: {
    flex: 1,
  },
  wheel: {},
});
