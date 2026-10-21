import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  public handleReload = () => {
    window.location.reload();
  };

  public handleGoHome = () => {
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            maxWidth: 500,
            width: '100%',
            background: '#ffffff',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '32px 28px',
            textAlign: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#fef2f2',
              color: '#dc2626',
              marginBottom: 16,
            }}>
              <AlertTriangle size={28} />
            </div>

            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text-main)' }}>
              Something Went Wrong
            </h2>

            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
              An unexpected error occurred while rendering this view. You can reload the page or return to the main dashboard.
            </p>

            {this.state.error?.message && (
              <div style={{
                background: 'var(--color-bg-subtle)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                fontSize: 12,
                color: '#64748b',
                fontFamily: 'monospace',
                textAlign: 'left',
                marginBottom: 24,
                overflowX: 'auto',
                maxHeight: 100,
              }}>
                {this.state.error.message}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={this.handleReload}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <RefreshCw size={16} /> Reload Page
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={this.handleGoHome}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Home size={16} /> Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
