import React from 'react';
import './EmptyState.css';

/**
 * EmptyState — teaches the interface when there is no data.
 *
 * Props:
 *   - icon: ReactNode *or* a component type (e.g. a Lucide icon like `Wallet`)
 *   - title: string
 *   - description: string
 *   - action: ReactNode (optional button/link)
 *   - className: string
 *   - style: object
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
  style = {},
}) {
  // Callers pass either an element (`icon={<Wallet size={40} />}`) or the bare
  // component (`icon={Wallet}`). Lucide icons are forwardRef *objects*, which
  // React cannot render as a child — that raised React error #31 in production.
  // Accept both forms instead of letting the mistake reach a user.
  const iconNode = React.isValidElement(icon)
    ? icon
    : typeof icon === 'function' || (icon && typeof icon === 'object' && icon.$$typeof)
      ? React.createElement(icon, { size: 40, strokeWidth: 1.5 })
      : icon;

  return (
    <div
      className={`be-empty-state ${className}`}
      style={style}
    >
      {iconNode && (
        <div className="be-empty-state__icon-wrap">
          {iconNode}
        </div>
      )}
      {title && (
        <h3 className="be-empty-state__title">
          {title}
        </h3>
      )}
      {description && (
        <p className="be-empty-state__description">
          {description}
        </p>
      )}
      {action && <div className="be-empty-state__action">{action}</div>}
    </div>
  );
}
