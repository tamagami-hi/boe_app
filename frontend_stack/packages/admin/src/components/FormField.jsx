export default function FormField({
  id,
  label,
  hint,
  error,
  wide = false,
  children,
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={wide ? 'adm-field adm-field--wide' : 'adm-field'}>
      <label className="adm-field-label" htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-describedby': errorId ?? hintId,
        'aria-invalid': error ? 'true' : undefined,
      })}
      {error
        ? <small className="adm-field-error" id={errorId} role="alert">{error}</small>
        : hint && <small className="adm-help-text" id={hintId}>{hint}</small>}
    </div>
  );
}
