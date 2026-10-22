import i18n from '../../../i18n';

export type ValidationField =
  | 'duration'
  | 'maxDepth'
  | 'repetitionCount'
  | 'plannedMaxDepth'
  | 'plannedDuration'
  | 'repetitionTarget'
  | 'startPressure'
  | 'endPressure';

export type NumberValidationMessages = {
  label: string;
  required: string;
  invalid: string;
  min: string;
  /** Contains a literal `{max}` for the caller to fill with the field's limit. */
  max: string;
  integer: string;
};

type ValidationText = 'ratingRange' | 'pressureUnitRequired' | 'dateTimeRequired' | 'plannedDateTimeRequired' | 'siteNameRequired';

/**
 * Builds messages in the current language when validation runs, so a language switch after the
 * schema module loads still applies. Korean particles follow the label's last syllable.
 */
export function numberValidationMessages(
  field: ValidationField,
  requiredVerb: 'enter' | 'select',
  maxSuffix = '',
): NumberValidationMessages {
  const label = String(i18n.t(`validationFields.${field}`));
  const grammar = {
    label,
    object: koreanParticle(label, '을', '를'),
    topic: koreanParticle(label, '은', '는'),
  };
  const verb = requiredVerb === 'enter' ? 'Enter' : 'Select';

  return {
    label,
    required: String(i18n.t(`validation.required${verb}`, grammar)),
    invalid: String(i18n.t('validation.invalidNumber', grammar)),
    min: String(i18n.t('validation.minZero', grammar)),
    // A unit such as `bar` follows the limit after a space, as in the value rows: `300 bar`.
    max: String(i18n.t(`validation.max${verb}`, { ...grammar, max: maxSuffix ? `{max} ${maxSuffix}` : '{max}' })),
    integer: String(i18n.t('validation.integerSelect', grammar)),
  };
}

export function validationText(key: ValidationText): string {
  return String(i18n.t(`validation.${key}`));
}

function koreanParticle(label: string, afterFinalConsonant: string, afterVowel: string): string {
  const syllables = [...label.replace(/\s*\([^)]*\)\s*$/, '')].filter(char => char >= '가' && char <= '힣');
  const last = syllables[syllables.length - 1];
  if (last === undefined) {
    return afterFinalConsonant;
  }

  return (last.charCodeAt(0) - 0xac00) % 28 === 0 ? afterVowel : afterFinalConsonant;
}
