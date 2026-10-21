import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonText } from '../../../components/ui/button';
import { HStack } from '../../../components/ui/hstack';
import { EditorField } from './editor-field';

type StarRatingFieldProps = {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  required?: boolean;
  error?: string;
  testID: string;
};

export function StarRatingField(props: StarRatingFieldProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <EditorField
      label={props.label}
      required={props.required}
      error={props.error}
      errorTestID={`${props.testID}-error`}
    >
      <HStack space="xs">
        {[1, 2, 3, 4, 5].map(rating => {
          const selected = props.value !== undefined && rating <= props.value;

          return (
            <Button
              key={rating}
              testID={`${props.testID}-star-${rating}`}
              size="icon"
              variant="ghost"
              accessibilityLabel={t('form.ratingStar', { value: rating, total: 5 })}
              accessibilityState={{ selected: props.value === rating }}
              className={selected ? 'min-h-11 min-w-11 bg-primary/10' : 'min-h-11 min-w-11 bg-muted'}
              onPress={() => props.onChange(props.value === rating ? undefined : rating)}
            >
              <ButtonText className={selected ? 'text-primary' : 'text-muted-foreground'}>
                {selected ? '★' : '☆'}
              </ButtonText>
            </Button>
          );
        })}
      </HStack>
    </EditorField>
  );
}
