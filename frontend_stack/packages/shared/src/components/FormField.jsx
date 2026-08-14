import React, { useId } from 'react';
import './FormField.css';

// Label, control, hint and error wired together. Forms were labelling controls with
// a bare <span>, and error text sat next to the input with nothing connecting them,
// so a screen reader announced an unlabelled field and never read the error.
//
// Usage: <FormField label="Amount" error={msg}>{(props) => <input {...props} />}</FormField>
// or pass a single element child and it receives the same props.
export default function FormField({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  className = '',
  children,
}) {
  const generated = useId();
  const id = htmlFor || generated;
  // The hint is hidden while an error shows, so it must not be referenced either —
  // aria-describedby pointing at a missing node announces nothing.
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const controlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    required: required || undefined,
  };

  const control = typeof children === 'function'
    ? children(controlProps)
    : React.isValidElement(children)
      ? React.cloneElement(children, controlProps)
      : children;

  return (
    <div className={`be-field ${error ? 'is-invalid' : ''} ${className}`}>
      {label && (
        <label className="be-field__label" htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {control}
      {hint && !error && <p className="be-field__hint" id={hintId}>{hint}</p>}
      {/* role="alert" so a validation failure is announced when it appears, not
          only when focus happens to land on the field. */}
      {error && <p className="be-field__error" id={errorId} role="alert">{error}</p>}
    </div>
  );
}
