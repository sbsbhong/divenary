import React from 'react';
import type { TextInputProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, ButtonIcon } from '../../../components/ui/button';
import { HStack } from '../../../components/ui/hstack';
import { AddIcon, CloseIcon, Icon } from '../../../components/ui/icon';
import { Input, InputField } from '../../../components/ui/input';
import { Pressable } from '../../../components/ui/pressable';
import { Text } from '../../../components/ui/text';
import { VStack } from '../../../components/ui/vstack';
import { EditorField } from './editor-field';

type BadgeListInputProps = {
  values: string[];
  onChange: (values: string[]) => void;
  inputTestID: string;
  /** What VoiceOver calls the text field, normally the row's visible label. */
  accessibilityLabel?: string;
  /** Prefix for `-badge-<value>`, `-remove-<value>` and `-suggestion-<value>`. */
  badgeTestIDPrefix: string;
  placeholder?: string;
  /** Names like buddies capitalize words; tags and gear use `none`. */
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  /** Earlier values offered as chips; tapping one adds it. Values already in the list are hidden. */
  suggestions?: string[];
};

export type BadgeListFieldHandle = {
  commitPending: () => string[];
};

/**
 * The badge list control alone, for a grouped `FieldRow`. A comma or return commits the typed
 * text as a badge, and blurring commits what is left.
 */
export const BadgeListInput = React.forwardRef<BadgeListFieldHandle, BadgeListInputProps>(function BadgeListInputWithRef(
  props,
  ref,
): React.JSX.Element {
  const { t } = useTranslation();
  const [pendingValue, setPendingValue] = React.useState('');
  const pendingValueRef = React.useRef('');

  const commitTokens = React.useCallback(
    (tokens: string[], options: { clearPending?: boolean } = {}) => {
      const nextValues = [...props.values];

      for (const token of tokens) {
        const normalizedToken = token.trim();
        if (normalizedToken.length && !nextValues.includes(normalizedToken)) {
          nextValues.push(normalizedToken);
        }
      }

      if (options.clearPending) {
        pendingValueRef.current = '';
        setPendingValue('');
      }

      props.onChange(nextValues);
      return nextValues;
    },
    [props],
  );

  const commitPending = React.useCallback(() => {
    return commitTokens([pendingValueRef.current], { clearPending: true });
  }, [commitTokens]);

  React.useImperativeHandle(ref, () => ({ commitPending }), [commitPending]);

  const handleChangeText = React.useCallback(
    (text: string) => {
      if (!text.includes(',')) {
        pendingValueRef.current = text;
        setPendingValue(text);
        return;
      }

      const parts = text.split(',');
      commitTokens(parts.slice(0, -1));
      const nextPendingValue = parts[parts.length - 1] ?? '';
      pendingValueRef.current = nextPendingValue;
      setPendingValue(nextPendingValue);
    },
    [commitTokens],
  );

  const handleSubmitEditing = React.useCallback(() => {
    commitPending();
  }, [commitPending]);

  const removeValue = React.useCallback(
    (value: string) => {
      props.onChange(props.values.filter(currentValue => currentValue !== value));
    },
    [props],
  );

  const suggestions = (props.suggestions ?? []).filter(value => !props.values.includes(value));

  return (
    <VStack space="sm">
      {props.values.length ? (
        <HStack space="xs" className="flex-wrap">
          {props.values.map(value => (
            <HStack
              key={value}
              testID={`${props.badgeTestIDPrefix}-badge-${value}`}
              space="xs"
              className="mr-1 items-center rounded-full bg-primary/10 px-2 py-1"
            >
              <Text className="text-xs font-semibold text-primary">{value}</Text>
              <Button
                testID={`${props.badgeTestIDPrefix}-remove-${value}`}
                size="icon"
                variant="ghost"
                accessibilityLabel={t('form.removeItem', { value })}
                hitSlop={14}
                className="ml-1 min-h-4 min-w-4 p-0"
                onPress={() => removeValue(value)}
              >
                <ButtonIcon as={CloseIcon} className="text-primary" />
              </Button>
            </HStack>
          ))}
        </HStack>
      ) : null}
      <Input className="h-11 rounded-xl bg-background">
        <InputField
          testID={props.inputTestID}
          // Without a label the vendored field announces the English words "Input Field".
          aria-label={props.accessibilityLabel ?? props.placeholder}
          value={pendingValue}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSubmitEditing}
          onBlur={commitPending}
          placeholder={props.placeholder}
          autoCapitalize={props.autoCapitalize}
          autoCorrect={props.autoCorrect}
          // Return commits a badge and keeps the keyboard up for the next one.
          submitBehavior="submit"
        />
      </Input>
      {suggestions.length ? (
        <HStack space="xs" className="flex-wrap">
          {suggestions.map(value => (
            <Pressable
              key={value}
              testID={`${props.badgeTestIDPrefix}-suggestion-${value}`}
              accessibilityRole="button"
              accessibilityLabel={t('form.addItem', { value })}
              onPress={() => commitTokens([value])}
              className="mb-1 mr-1 min-h-11 flex-row items-center gap-1 rounded-full bg-muted px-3"
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}
            >
              <Icon as={AddIcon} size="xs" className="text-muted-foreground" />
              <Text className="text-sm text-foreground">{value}</Text>
            </Pressable>
          ))}
        </HStack>
      ) : null}
    </VStack>
  );
});

type BadgeListFieldProps = BadgeListInputProps & {
  label: string;
  required?: boolean;
  error?: string;
  className?: string;
};

/** The badge list with its own label block, for the current card-style editors. */
export const BadgeListField = React.forwardRef<BadgeListFieldHandle, BadgeListFieldProps>(function BadgeListFieldWithRef(
  { label, required, error, className, ...inputProps },
  ref,
): React.JSX.Element {
  return (
    <EditorField
      label={label}
      required={required}
      error={error}
      errorTestID={`${inputProps.inputTestID}-error`}
      className={className}
    >
      <BadgeListInput ref={ref} accessibilityLabel={label} {...inputProps} />
    </EditorField>
  );
});
