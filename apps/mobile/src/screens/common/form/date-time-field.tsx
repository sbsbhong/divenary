import DateTimePickerNative, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { Box } from '../../../components/ui/box';
import { HStack } from '../../../components/ui/hstack';
import { CalendarDaysIcon, ChevronDownIcon, ClockIcon, Icon } from '../../../components/ui/icon';
import { Pressable } from '../../../components/ui/pressable';
import { Text } from '../../../components/ui/text';
import { EditorField } from './editor-field';

type DateTimeFieldProps = {
  label: string;
  value?: Date;
  onChange: (value: Date | undefined) => void;
  required?: boolean;
  error?: string;
  testID: string;
  onLayout?: React.ComponentProps<typeof EditorField>['onLayout'];
};

export function DateTimeField(props: DateTimeFieldProps): React.JSX.Element {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = React.useState(false);
  const displayDate = props.value ? formatDatePart(props.value) : t('form.datePlaceholder');
  const displayTime = props.value ? formatTimePart(props.value) : t('form.timePlaceholder');

  const handleValueChange = React.useCallback(
    (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
      if (Platform.OS !== 'ios') {
        setIsOpen(false);
      }

      props.onChange(selectedDate);
    },
    [props],
  );

  const handleDismiss = React.useCallback(() => {
    if (Platform.OS !== 'ios') {
      setIsOpen(false);
    }
  }, []);

  return (
    <EditorField
      label={props.label}
      required={props.required}
      error={props.error}
      errorTestID={`${props.testID}-error`}
      onLayout={props.onLayout}
      testID={`${props.testID}-anchor`}
    >
      <Pressable
        testID={`${props.testID}-trigger`}
        accessibilityRole="button"
        accessibilityLabel={props.label}
        onPress={() => setIsOpen(currentValue => !currentValue)}
      >
        <HStack
          className="min-h-12 items-center rounded-xl border border-border bg-card px-3 py-2"
          space="sm"
        >
          <Box className="h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Icon as={CalendarDaysIcon} size="sm" className="text-primary" />
          </Box>
          <HStack className="flex-1 items-center justify-between" space="md">
            <Text testID={`${props.testID}-date`} className="text-sm font-semibold text-foreground">
              {displayDate}
            </Text>
            <HStack className="items-center" space="xs">
              <Icon as={ClockIcon} size="xs" className="text-muted-foreground" />
              <Text testID={`${props.testID}-time`} className="text-sm font-semibold text-foreground">
                {displayTime}
              </Text>
            </HStack>
          </HStack>
          <Icon as={ChevronDownIcon} size="xs" className={isOpen ? 'text-primary' : 'text-muted-foreground'} />
        </HStack>
      </Pressable>
      {isOpen ? (
        <DateTimePickerNative
          testID={`${props.testID}-picker`}
          value={props.value ?? new Date()}
          mode="datetime"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onValueChange={handleValueChange}
          onDismiss={handleDismiss}
        />
      ) : null}
    </EditorField>
  );
}

function formatDatePart(value: Date): string {
  const pad = (input: number) => `${input}`.padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function formatTimePart(value: Date): string {
  const pad = (input: number) => `${input}`.padStart(2, '0');
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function formatDateTime(value: Date): string {
  return [formatDatePart(value), formatTimePart(value)].join(' ');
}
