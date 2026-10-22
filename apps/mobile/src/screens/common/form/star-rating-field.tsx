import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonText } from '../../../components/ui/button';
import { HStack } from '../../../components/ui/hstack';
import { EditorField } from './editor-field';

type StarRatingControlProps = {
  value?: number;
  onChange: (value: number | undefined) => void;
  /** Prefix for `-star-1` … `-star-5`. */
  testID: string;
};

/** Five 44pt stars; tapping the selected star again clears the rating. For a grouped `FieldRow`. */
export function StarRatingControl(props: StarRatingControlProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
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
  );
}

type StarRatingFieldProps = StarRatingControlProps & {
  label: string;
  required?: boolean;
  error?: string;
};

/** The star rating with its own label block, for the current card-style editors. */
export function StarRatingField(props: StarRatingFieldProps): React.JSX.Element {
  return (
    <EditorField
      label={props.label}
      required={props.required}
      error={props.error}
      errorTestID={`${props.testID}-error`}
    >
      <StarRatingControl value={props.value} onChange={props.onChange} testID={props.testID} />
    </EditorField>
  );
}
