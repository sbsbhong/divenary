import React from 'react';
import {useTranslation} from 'react-i18next';

import {Box} from '../../components/ui/box';
import {Button, ButtonText} from '../../components/ui/button';
import {AlertCircleIcon, Icon} from '../../components/ui/icon';
import {SafeAreaView} from '../../components/ui/safe-area-view';
import {Spinner} from '../../components/ui/spinner';
import {Text} from '../../components/ui/text';
import {VStack} from '../../components/ui/vstack';

type RecoveryScreenProps = {
  kind: 'loading' | 'accountData' | 'unexpected';
  onRetry?: () => void;
};

export default function RecoveryScreen({
  kind,
  onRetry,
}: RecoveryScreenProps): React.JSX.Element {
  const {t} = useTranslation();
  const isLoading = kind === 'loading';
  const testID =
    kind === 'accountData'
      ? 'account-data-recovery-screen'
      : kind === 'unexpected'
        ? 'app-error-recovery-screen'
        : 'account-data-loading-screen';

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Box className="flex-1 items-center justify-center px-8 py-10">
        <VStack testID={testID} space="xl" className="w-full max-w-md items-center">
          {isLoading ? (
            <Spinner size="large" className="text-primary" />
          ) : (
            <Box className="h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <Icon as={AlertCircleIcon} size="xl" className="text-destructive" />
            </Box>
          )}
          <VStack space="sm" className="items-center">
            <Text
              accessibilityRole="header"
              size="xl"
              bold
              className="text-center text-foreground">
              {t(`recovery.${kind}.title`)}
            </Text>
            <Text size="sm" className="text-center leading-5 text-muted-foreground">
              {t(`recovery.${kind}.description`)}
            </Text>
          </VStack>
          {!isLoading && onRetry ? (
            <Button
              testID="recovery-retry"
              accessibilityLabel={t('common.retry')}
              size="lg"
              className="min-h-12 w-full rounded-xl"
              onPress={onRetry}>
              <ButtonText>{t('common.retry')}</ButtonText>
            </Button>
          ) : null}
        </VStack>
      </Box>
    </SafeAreaView>
  );
}
