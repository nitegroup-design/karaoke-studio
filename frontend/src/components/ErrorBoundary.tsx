import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in UI component:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--bg, #111216)',
          color: 'var(--text, #F7F3EB)',
          fontFamily: 'Inter, system-ui, sans-serif'
        }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#f59e0b' }}>
            Đã có sự cố khi hiển thị giao diện
          </h2>
          <p style={{ maxWidth: '600px', opacity: 0.8, marginBottom: '1.5rem' }}>
            {this.state.error?.message || 'Lỗi không xác định.'}
          </p>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              onClick={() => this.setState({ hasError: false })}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: '8px',
                background: '#f59e0b',
                color: '#111216',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Thử tải lại bảng này
            </button>
            <a
              href="#/"
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.1)',
                color: '#F7F3EB',
                textDecoration: 'none',
                fontWeight: 600
              }}
            >
              Về thư viện bài hát
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
