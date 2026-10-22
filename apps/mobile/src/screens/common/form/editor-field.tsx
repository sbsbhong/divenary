import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  FormControl,
  FormControlError,
  FormControlErrorIcon,
  FormControlErrorText,
  FormControlLabel,
  FormControlLabelText,
} from '../../../components/ui/form-control';
import { HStack } from '../../../components/ui/hstack';
import { AlertCircleIcon } from '../../../components/ui/icon';
import { Text } from '../../../components/ui/text';
import { VStack } from '../../../components/ui/vstack';

type EditorFieldProps = {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
  errorTestID?: string;
  labelTestID?: string;
  onLayout?: React.ComponentProps<typeof FormControl>['onLayout'];
  testID?: string;
};

export function EditorField(props: EditorFieldProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <FormControl testID={props.testID} onLayout={props.onLayout} isInvalid={Boolean(props.error)} className={props.className}>
      <VStack space="xs">
        <FormControlLabel>
          <HStack space="xs" className="items-center">
            <FormControlLabelText testID={props.labelTestID} className="text-xs font-semibold uppercase text-muted-foreground">
              {props.label}
            </FormControlLabelText>
            {props.required ? (
              <Text className="text-xs text-muted-foreground">{t('form.required')}</Text>
            ) : null}
          </HStack>
        </FormControlLabel>
        {props.children}
        {props.error ? (
          <FormControlError className="rounded-xl bg-destructive/10 px-3 py-2">
            <FormControlErrorIcon as={AlertCircleIcon} />
            <FormControlErrorText testID={props.errorTestID} className="flex-1 font-semibold leading-4">
              {props.error}
            </FormControlErrorText>
          </FormControlError>
        ) : null}
      </VStack>
    </FormControl>
  );
}
