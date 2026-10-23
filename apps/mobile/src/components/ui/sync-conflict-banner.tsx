import React from 'react';
import { useTranslation } from 'react-i18next';
import { FadeInView } from './fade-in-view';
import { InstrumentButton } from './instrument';
import { Text } from './text';
import { VStack } from './vstack';

export type SyncConflictChoice = 'keepLocal' | 'useRemote';

/** Lets the user pick which version of a row that another device also edited survives. */
export function SyncConflictBanner(props: {
  onResolve: (choice: SyncConflictChoice) => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [isResolving, setIsResolving] = React.useState(false);
  const [hasFailed, setHasFailed] = React.useState(false);
  const { onResolve } = props;

  const resolve = React.useCallback(
    async (choice: SyncConflictChoice) => {
      setIsResolving(true);
      setHasFailed(false);
      try {
        await onResolve(choice);
      } catch {
        setHasFailed(true);
      } finally {
        setIsResolving(false);
      }
    },
    [onResolve],
  );

  // A late conditional block, so it fades in wherever it is shown.
  return (
    <FadeInView>
      <VStack space="sm" className="rounded-2xl bg-muted px-4 py-4" accessibilityRole="summary">
        <Text testID="sync-conflict-title" className="text-base font-semibold text-card-foreground">
          {t('common.syncConflict.title')}
        </Text>
        <Text size="sm" className="leading-5 text-muted-foreground">
          {t('common.syncConflict.message')}
        </Text>
        {hasFailed ? (
          <Text testID="sync-conflict-error" size="sm" className="leading-5 text-destructive">
            {t('common.syncConflict.failed')}
          </Text>
        ) : null}
        <InstrumentButton
          testID="sync-conflict-keep-local"
          label={t('common.syncConflict.keepLocal')}
          variant="primary"
          disabled={isResolving}
          onPress={() => resolve('keepLocal')}
        />
        <InstrumentButton
          testID="sync-conflict-use-remote"
          label={t('common.syncConflict.useRemote')}
          disabled={isResolving}
          onPress={() => resolve('useRemote')}
        />
      </VStack>
    </FadeInView>
  );
}
