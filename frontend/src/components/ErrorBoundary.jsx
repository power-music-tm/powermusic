import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App render error:', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: "var(--font-family, 'Outfit', sans-serif)",
          background: '#f8f9fb',
          color: '#1a1a2e',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '1.25rem' }}>
            {error.message || 'The app hit an unexpected error.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '0.6rem 1rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#1a1a2e',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
