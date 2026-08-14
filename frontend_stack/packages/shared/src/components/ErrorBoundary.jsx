import { Component } from 'react';

const WRAPPER_STYLE = {
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--be-space-6)',
  background: 'var(--be-bg)',
};

const CARD_STYLE = {
  maxWidth: '480px',
  width: '100%',
  background: 'var(--be-bg-elevated)',
  borderRadius: 'var(--be-radius-lg)',
  padding: 'var(--be-space-10) var(--be-space-8)',
  textAlign: 'center',
  boxShadow: 'var(--be-shadow-2)',
};

const ICON_WRAP_STYLE = {
  width: '64px',
  height: '64px',
  borderRadius: '50%',
  background: 'var(--be-red-soft)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto var(--be-space-5)',
  fontSize: '28px',
};

const TITLE_STYLE = {
  margin: '0 0 var(--be-space-2)',
  fontSize: 'var(--be-text-xl)',
  fontWeight: 700,
  color: 'var(--be-fg)',
};

const MESSAGE_STYLE = {
  margin: '0 0 var(--be-space-6)',
  fontSize: 'var(--be-text-sm)',
  color: 'var(--be-fg-muted)',
  lineHeight: 'var(--be-lh-normal)',
};

const BUTTON_STYLE = {
  padding: '10px 24px',
  borderRadius: 'var(--be-radius-md)',
  border: 'none',
  background: 'var(--be-accent)',
  color: 'var(--be-fg-inverse)',
  fontSize: 'var(--be-text-sm)',
  fontWeight: 600,
  cursor: 'pointer',
};

const DETAILS_STYLE = {
  marginTop: 'var(--be-space-5)',
  padding: 'var(--be-space-3)',
  background: 'var(--be-surface)',
  borderRadius: 'var(--be-radius-md)',
  fontSize: '11px',
  color: 'var(--be-fg)',
  overflow: 'auto',
  textAlign: 'left',
  maxHeight: '200px',
};

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={WRAPPER_STYLE}>
          <div style={CARD_STYLE}>
            <div style={ICON_WRAP_STYLE}>⚠️</div>
            <h2 style={TITLE_STYLE}>
              Something went wrong
            </h2>
            <p style={MESSAGE_STYLE}>
              We encountered an unexpected error. Please try refreshing the page or contact support if the problem persists.
            </p>
            <button type="button"
              onClick={() => window.location.reload()}
              style={BUTTON_STYLE}
            >
              Refresh page
            </button>
            {this.props.showDetails && this.state.error && (
              <pre style={DETAILS_STYLE}>
                {this.state.error.toString()}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
