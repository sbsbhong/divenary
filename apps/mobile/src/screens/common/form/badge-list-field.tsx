import React from 'react';
import { Button, ButtonIcon } from '../../../components/ui/button';
import { HStack } from '../../../components/ui/hstack';
import { CloseIcon } from '../../../components/ui/icon';
import { Input, InputField } from '../../../components/ui/input';
import { Text } from '../../../components/ui/text';
import { VStack } from '../../../components/ui/vstack';
import { EditorField } from './editor-field';

type BadgeListFieldProps = {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  required?: boolean;
  error?: string;
  inputTestID: string;
  badgeTestIDPrefix: string;
  placeholder?: string;
  className?: string;
};

export type BadgeListFieldHandle = {
  commitPending: () => string[];
};

export const BadgeListField = React.forwardRef<BadgeListFieldHandle, BadgeListFieldProps>(
function BadgeListField(props, ref): React.JSX.Element {
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

  return (
    <EditorField
      label={props.label}
      required={props.required}
      error={props.error}
      errorTestID={`${props.inputTestID}-error`}
      className={props.className}
    >
      <VStack space="sm">
        {props.values.length ? (
          <HStack space="xs" className="flex-wrap">
            {props.values.map((value, index) => {
              const badgeTone = primaryBadgeTone;

              return (
              <HStack
                key={value}
                testID={`${props.badgeTestIDPrefix}-badge-${value}`}
                space="xs"
                className={`mr-1 items-center rounded-full border px-2 py-1 ${badgeTone.container}`}
              >
                <Text className={`text-xs font-semibold ${badgeTone.text}`}>{value}</Text>
                <Button
                  testID={`${props.badgeTestIDPrefix}-remove-${value}`}
                  size="icon"
                  variant="ghost"
                  accessibilityLabel={`${value} 삭제`}
                  className="ml-1 min-h-4 min-w-4 p-0"
                  onPress={() => removeValue(value)}
                >
                  <ButtonIcon as={CloseIcon} className={badgeTone.text} />
                </Button>
              </HStack>
              );
            })}
          </HStack>
        ) : null}
        <Input className="h-11 rounded-xl bg-background">
          <InputField
            testID={props.inputTestID}
            value={pendingValue}
            onChangeText={handleChangeText}
            onSubmitEditing={handleSubmitEditing}
            onBlur={commitPending}
            placeholder={props.placeholder}
          />
        </Input>
      </VStack>
    </EditorField>
  );
}
);

const primaryBadgeTone = { container: 'border-primary/20 bg-primary/10', text: 'text-primary' };
