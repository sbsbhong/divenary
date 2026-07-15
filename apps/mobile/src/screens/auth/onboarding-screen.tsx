import type { RequiredLegalDocument } from '@repo/supabase';
import React from 'react';
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Box } from '../../components/ui/box';
import { Checkbox, CheckboxIcon, CheckboxIndicator, CheckboxLabel } from '../../components/ui/checkbox';
import { CheckIcon } from '../../components/ui/icon';
import { InstrumentButton, StatusPill } from '../../components/ui/instrument';
import { Pressable } from '../../components/ui/pressable';
import { SafeAreaView } from '../../components/ui/safe-area-view';
import { ScrollView } from '../../components/ui/scroll-view';
import { Text } from '../../components/ui/text';
import { VStack } from '../../components/ui/vstack';
import { useAuth } from '../../states/auth';

type DocumentKind = RequiredLegalDocument['kind'];
type CheckedDocuments = Partial<Record<DocumentKind, boolean>>;

export default function OnboardingScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const auth = useAuth();
  const documents = React.useMemo(() => (auth.state.status === 'pendingOnboarding' ? auth.state.documents : []), [auth.state]);
  const documentKey = documents.map(document => `${document.kind}:${document.version}`).join('|');
  const [checked, setChecked] = React.useState<CheckedDocuments>({});
  const [isBusy, setIsBusy] = React.useState(false);
  const [errorKey, setErrorKey] = React.useState<'error' | 'linkUnavailable' | undefined>(undefined);
  const actionInFlight = React.useRef(false);
  const linksAreValid = documents.every(document => getSafeLegalUrl(document.documentUrl) !== undefined);
  const allDocumentsChecked = documents.length > 0 && documents.every(document => checked[document.kind] === true);

  React.useEffect(() => {
    setChecked({});
    setErrorKey(undefined);
  }, [documentKey]);

  const openDocument = React.useCallback(async (document: RequiredLegalDocument) => {
    const url = getSafeLegalUrl(document.documentUrl);

    if (url === undefined) {
      setErrorKey('linkUnavailable');
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      setErrorKey('linkUnavailable');
    }
  }, []);

  const submit = React.useCallback(async () => {
    if (actionInFlight.current || !allDocumentsChecked || !linksAreValid) {
      return;
    }

    actionInFlight.current = true;
    setIsBusy(true);
    setErrorKey(undefined);

    try {
      await auth.completeOnboarding(documents.map(({ kind, version }) => ({ kind, version })));
    } catch {
      setErrorKey('error');
    } finally {
      actionInFlight.current = false;
      setIsBusy(false);
    }
  }, [allDocumentsChecked, auth, documents, linksAreValid]);

  const cancel = React.useCallback(async () => {
    if (actionInFlight.current) {
      return;
    }

    actionInFlight.current = true;
    setIsBusy(true);
    setErrorKey(undefined);

    try {
      await auth.cancelOnboarding();
    } catch {
      setErrorKey('error');
      actionInFlight.current = false;
      setIsBusy(false);
    }
  }, [auth]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        <VStack testID="auth-onboarding-screen" className="gap-6 px-5 pb-10 pt-6">
          <VStack className="gap-3">
            <StatusPill label={t('auth.onboarding.eyebrow')} />
            <Text className="text-3xl font-semibold leading-9 text-foreground">{t('auth.onboarding.title')}</Text>
            <Text className="text-base leading-6 text-muted-foreground">{t('auth.onboarding.subtitle')}</Text>
          </VStack>

          <VStack className="gap-4">
            {documents.map(document => {
              const documentName = t(`auth.onboarding.${document.kind}`);
              const legalUrl = getSafeLegalUrl(document.documentUrl);

              return (
                <VStack key={`${document.kind}:${document.version}`} className="gap-3 rounded-3xl bg-card p-5">
                  <Checkbox
                    testID={`auth-onboarding-document-${document.kind}`}
                    accessibilityLabel={t('auth.onboarding.agree', {
                      document: documentName,
                    })}
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      checked: checked[document.kind] === true,
                      disabled: isBusy,
                    }}
                    className="min-h-11 items-start"
                    isChecked={checked[document.kind] === true}
                    isDisabled={isBusy}
                    onChange={isChecked => {
                      setChecked(current => ({
                        ...current,
                        [document.kind]: isChecked,
                      }));
                    }}
                    value={`${document.kind}:${document.version}`}>
                    <CheckboxIndicator className="mt-1 h-5 w-5">
                      <CheckboxIcon as={CheckIcon} />
                    </CheckboxIndicator>
                    <CheckboxLabel className="flex-1 text-base leading-6">
                      {t('auth.onboarding.agree', {
                        document: documentName,
                      })}
                    </CheckboxLabel>
                  </Checkbox>

                  <Text className="text-xs font-semibold uppercase text-muted-foreground">
                    {t('auth.onboarding.version', {
                      version: document.version,
                    })}
                  </Text>

                  <Pressable
                    testID={`auth-onboarding-link-${document.kind}`}
                    accessibilityLabel={t('auth.onboarding.openDocument', {
                      document: documentName,
                    })}
                    accessibilityRole="link"
                    accessibilityState={{
                      disabled: isBusy || legalUrl === undefined,
                    }}
                    className="min-h-11 justify-center self-start rounded-full bg-primary/10 px-4 py-2"
                    disabled={isBusy || legalUrl === undefined}
                    onPress={() => openDocument(document)}>
                    <Text className="text-sm font-semibold text-primary">
                      {t('auth.onboarding.openDocument', {
                        document: documentName,
                      })}
                    </Text>
                  </Pressable>
                </VStack>
              );
            })}
          </VStack>

          {!linksAreValid || errorKey !== undefined ? (
            <Box className="rounded-2xl bg-destructive/10 px-4 py-3">
              <Text testID="auth-onboarding-error" accessibilityRole="alert" className="text-sm leading-5 text-destructive">
                {t(`auth.onboarding.${!linksAreValid ? 'linkUnavailable' : errorKey}`)}
              </Text>
            </Box>
          ) : null}

          <VStack className="gap-3">
            <InstrumentButton
              testID="auth-onboarding-submit"
              accessibilityLabel={t('auth.onboarding.submit')}
              accessibilityRole="button"
              className="min-h-12"
              disabled={isBusy || !allDocumentsChecked || !linksAreValid}
              label={isBusy ? t('auth.onboarding.submitting') : t('auth.onboarding.submit')}
              onPress={submit}
              variant="primary"
            />
            <InstrumentButton
              testID="auth-onboarding-cancel"
              accessibilityLabel={t('auth.onboarding.cancel')}
              accessibilityRole="button"
              className="min-h-12"
              disabled={isBusy}
              label={t('auth.onboarding.cancel')}
              onPress={cancel}
              variant="secondary"
            />
          </VStack>
        </VStack>
      </ScrollView>
    </SafeAreaView>
  );
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
