import type { RequiredLegalDocument } from '@repo/supabase';
import React from 'react';
import { AccessibilityInfo, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Box } from '../../components/ui/box';
import { Checkbox } from '../../components/ui/checkbox';
import { HStack } from '../../components/ui/hstack';
import { CheckCircleIcon, ChevronRightIcon, CircleIcon, Icon } from '../../components/ui/icon';
import { InstrumentButton } from '../../components/ui/instrument';
import { Pressable } from '../../components/ui/pressable';
import { SafeAreaView } from '../../components/ui/safe-area-view';
import { ScrollView } from '../../components/ui/scroll-view';
import { StickyActionBar } from '../../components/ui/sticky-action-bar';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { useAuth } from '../../states/auth';

type DocumentKind = RequiredLegalDocument['kind'];
type CheckedDocuments = Partial<Record<DocumentKind, boolean>>;
type OnboardingError = 'submit' | 'openFailed';

export default function OnboardingScreen(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const documents = React.useMemo(() => (auth.state.status === 'pendingOnboarding' ? auth.state.documents : []), [auth.state]);
  const documentKey = documents.map(document => `${document.kind}:${document.version}`).join('|');
  const [checked, setChecked] = React.useState<CheckedDocuments>({});
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<{ kind: OnboardingError; document?: RequiredLegalDocument }>();
  const actionInFlight = React.useRef(false);
  // Without valid documents nothing can be agreed to; the user can only cancel and sign in again.
  const documentsAvailable = documents.length > 0 && documents.every(document => getSafeLegalUrl(document.documentUrl) !== undefined);
  const allDocumentsChecked = documents.length > 0 && documents.every(document => checked[document.kind] === true);
  const errorMessage = !documentsAvailable
    ? t('auth.onboarding.documentsUnavailable')
    : error?.kind === 'openFailed'
      ? t('auth.onboarding.linkUnavailable')
      : error?.kind === 'submit'
        ? t('auth.onboarding.error')
        : undefined;

  React.useEffect(() => {
    setChecked({});
    setError(undefined);
  }, [documentKey]);

  React.useEffect(() => {
    if (errorMessage) {
      AccessibilityInfo.announceForAccessibility(errorMessage);
    }
  }, [errorMessage]);

  const openDocument = React.useCallback(async (document: RequiredLegalDocument) => {
    const url = getSafeLegalUrl(document.documentUrl);

    if (url === undefined) {
      return;
    }

    setError(undefined);
    try {
      await Linking.openURL(url);
    } catch {
      setError({ kind: 'openFailed', document });
    }
  }, []);

  const setDocumentChecked = React.useCallback((kind: DocumentKind, isChecked: boolean) => {
    setChecked(current => ({ ...current, [kind]: isChecked }));
  }, []);

  const setAllChecked = React.useCallback(
    (isChecked: boolean) => {
      setChecked(Object.fromEntries(documents.map(document => [document.kind, isChecked])));
    },
    [documents],
  );

  const submit = React.useCallback(async () => {
    if (actionInFlight.current || !allDocumentsChecked || !documentsAvailable) {
      return;
    }

    actionInFlight.current = true;
    setIsBusy(true);
    setError(undefined);

    try {
      await auth.completeOnboarding(documents.map(({ kind, version }) => ({ kind, version })));
    } catch {
      setError({ kind: 'submit' });
    } finally {
      actionInFlight.current = false;
      setIsBusy(false);
    }
  }, [allDocumentsChecked, auth, documents, documentsAvailable]);

  const cancel = React.useCallback(async () => {
    if (actionInFlight.current) {
      return;
    }

    actionInFlight.current = true;
    setIsBusy(true);
    setError(undefined);

    try {
      await auth.cancelOnboarding();
    } catch {
      setError({ kind: 'submit' });
      actionInFlight.current = false;
      setIsBusy(false);
    }
  }, [auth]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-background">
      <HStack className="min-h-11 items-center px-3">
        <Pressable
          testID="auth-onboarding-cancel"
          accessibilityLabel={t('auth.onboarding.cancel')}
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          className="min-h-11 justify-center px-2"
          disabled={isBusy}
          hitSlop={8}
          onPress={cancel}>
          <Text className={isBusy ? 'text-base text-muted-foreground' : 'text-base text-primary'}>{t('auth.onboarding.cancel')}</Text>
        </Pressable>
      </HStack>
      <ScrollView className="flex-1">
        <VStack testID="auth-onboarding-screen" className="gap-6 px-5 pb-6 pt-2">
          <Text accessibilityRole="header" className="text-3xl font-semibold leading-9 text-foreground">
            {t('auth.onboarding.title')}
          </Text>

          {documents.length > 0 ? (
            <VStack className="overflow-hidden rounded-2xl bg-card">
              <ConsentCheck
                controlTestID="auth-onboarding-all"
                label={t('auth.onboarding.agreeAll')}
                checked={allDocumentsChecked}
                disabled={isBusy || !documentsAvailable}
                onChange={setAllChecked}
                emphasized
              />
              {documents.map(document => {
                const documentName = t(`auth.onboarding.${document.kind}`);
                const legalUrl = getSafeLegalUrl(document.documentUrl);

                return (
                  <VStack key={`${document.kind}:${document.version}`}>
                    <Box className="ml-4 h-px bg-background" />
                    <HStack className="items-center pr-2">
                      <ConsentCheck
                        controlTestID={`auth-onboarding-document-${document.kind}`}
                        label={t('auth.onboarding.requiredDocument', { document: documentName })}
                        accessibilityLabel={t('auth.onboarding.agree', { document: documentName })}
                        detail={formatEffectiveDate(document.effectiveAt, i18n.language, t)}
                        checked={checked[document.kind] === true}
                        disabled={isBusy}
                        onChange={isChecked => setDocumentChecked(document.kind, isChecked)}
                      />
                      <Pressable
                        testID={`auth-onboarding-link-${document.kind}`}
                        accessibilityLabel={t('auth.onboarding.openDocument', {
                          document: documentName,
                        })}
                        accessibilityRole="link"
                        accessibilityState={{
                          disabled: isBusy || legalUrl === undefined,
                        }}
                        className="min-h-11 flex-row items-center justify-center gap-1 px-2"
                        disabled={isBusy || legalUrl === undefined}
                        onPress={() => openDocument(document)}>
                        <Text className="text-sm text-muted-foreground">{t('auth.onboarding.view')}</Text>
                        <Icon as={ChevronRightIcon} className="text-muted-foreground" />
                      </Pressable>
                    </HStack>
                  </VStack>
                );
              })}
            </VStack>
          ) : null}

          {errorMessage ? (
            <VStack space="sm" className="rounded-2xl bg-destructive/10 px-4 py-3">
              <Text testID="auth-onboarding-error" accessibilityRole="alert" className="text-sm leading-5 text-destructive">
                {errorMessage}
              </Text>
              {error?.kind === 'openFailed' && error.document ? (
                <Pressable
                  testID="auth-onboarding-retry"
                  accessibilityRole="button"
                  accessibilityLabel={t('common.retry')}
                  className="min-h-11 justify-center self-start"
                  onPress={() => {
                    if (error.document) {
                      void openDocument(error.document);
                    }
                  }}>
                  <Text className="text-sm font-semibold text-primary">{t('common.retry')}</Text>
                </Pressable>
              ) : null}
            </VStack>
          ) : null}
        </VStack>
      </ScrollView>
      <StickyActionBar>
        <InstrumentButton
          testID="auth-onboarding-submit"
          accessibilityLabel={t('auth.onboarding.submit')}
          accessibilityRole="button"
          className="min-h-12"
          disabled={isBusy || !allDocumentsChecked || !documentsAvailable}
          pending={isBusy}
          label={t('auth.onboarding.submit')}
          onPress={submit}
          variant="primary"
        />
      </StickyActionBar>
    </SafeAreaView>
  );
}

type ConsentCheckProps = {
  /** Passed to the checkbox itself, so tests and assistive tech reach the real control. */
  controlTestID: string;
  label: string;
  accessibilityLabel?: string;
  detail?: string;
  checked: boolean;
  disabled: boolean;
  emphasized?: boolean;
  onChange: (isChecked: boolean) => void;
};

/** One consent row: a round check in the selection colour, the label and an optional date line. */
function ConsentCheck(props: ConsentCheckProps): React.JSX.Element {
  return (
    <Checkbox
      testID={props.controlTestID}
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityRole="checkbox"
      accessibilityState={{
        checked: props.checked,
        disabled: props.disabled,
      }}
      className="min-h-12 flex-1 gap-3 px-4 py-3"
      isChecked={props.checked}
      isDisabled={props.disabled}
      onChange={props.onChange}
      value={props.controlTestID}>
      <Icon as={props.checked ? CheckCircleIcon : CircleIcon} size="lg" className={props.checked ? 'text-primary' : 'text-muted-foreground'} />
      <VStack className="flex-1">
        <Text className={props.emphasized ? 'text-base font-semibold text-card-foreground' : 'text-base text-card-foreground'}>
          {props.label}
        </Text>
        {props.detail ? <Text className="text-sm leading-5 text-muted-foreground">{props.detail}</Text> : null}
      </VStack>
    </Checkbox>
  );
}

function formatEffectiveDate(
  effectiveAt: string,
  language: string,
  t: ReturnType<typeof useTranslation>['t'],
): string | undefined {
  const date = new Date(effectiveAt);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  // Legal documents take effect on a calendar date, so read it in UTC instead of the device zone.
  const formatted = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);

  return t('auth.onboarding.effectiveDate', { date: formatted });
}

function getSafeLegalUrl(candidate: string): string | undefined {
  try {
    const parsed = new URL(candidate);

    if (parsed.protocol !== 'https:' || parsed.hostname.length === 0 || parsed.username.length > 0 || parsed.password.length > 0) {
      return undefined;
    }

    return candidate;
  } catch {
    return undefined;
  }
}
