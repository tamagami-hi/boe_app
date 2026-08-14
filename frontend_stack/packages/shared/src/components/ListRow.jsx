import React from 'react';
import './ListRow.css';

// A tappable list row that is a real control. The app was full of
// `<div onClick>` rows: not focusable, not announced, no Enter/Space, no target
// guarantee. This renders a <button> when it has an onPress, whatever `as` says for
// a link (pass `as={Link} to=...`), and a plain <div> when it is not interactive.
export default function ListRow({
  as: Component,
  onPress,
  leading,
  title,
  meta,
  trailing,
  value,
  disabled = false,
  selected = false,
  className = '',
  children,
  ...rest
}) {
  const interactive = Boolean(onPress || Component);
  const Element = Component || (onPress ? 'button' : 'div');
  const classes = [
    'be-row',
    interactive && 'be-row--interactive',
    selected && 'is-selected',
    disabled && 'is-disabled',
    className,
  ].filter(Boolean).join(' ');

  const props = { className: classes, ...rest };
  if (Element === 'button') {
    props.type = 'button';
    props.disabled = disabled;
    props.onClick = onPress;
  } else if (interactive) {
    props.onClick = onPress;
    if (selected) props['aria-current'] = 'true';
  }

  return (
    <Element {...props}>
      {leading && <span className="be-row__leading">{leading}</span>}
      <span className="be-row__body">
        {title && <span className="be-row__title">{title}</span>}
        {meta && <span className="be-row__meta">{meta}</span>}
        {children}
      </span>
      {(value || trailing) && (
        <span className="be-row__trailing">
          {value && <span className="be-row__value">{value}</span>}
          {trailing}
        </span>
      )}
    </Element>
  );
}
