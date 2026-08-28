import { FormField as SharedFormField } from '@beonedge/shared';

export default function FormField({
  id,
  label,
  hint,
  error,
  wide = false,
  children,
}) {
  return (
    <SharedFormField
      htmlFor={id}
      label={label}
      hint={hint}
      error={error}
      className={wide ? 'adm-field adm-field--wide' : 'adm-field'}
      labelClassName="adm-field-label"
      hintClassName="adm-help-text"
      errorClassName="adm-field-error"
    >
      {children}
    </SharedFormField>
  );
}
