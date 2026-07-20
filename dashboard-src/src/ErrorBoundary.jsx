import React from 'react';

// Without this, any uncaught render error unmounts the tree and leaves a
// blank white page with no clue why.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13, padding: 24, color: '#d03b3b' }}>
          <p>Something went wrong loading the dashboard.</p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
