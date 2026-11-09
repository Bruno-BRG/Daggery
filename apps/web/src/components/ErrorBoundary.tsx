import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; name?: string; resetKey?: string; onBack?: () => void }
interface State { error: Error | null }

/** A failed campaign section must not unmount the rest of the workspace. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error('The interface could not load.') };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Daggery interface error:', error, info.componentStack);
  }
  override componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  override render() {
    if (this.state.error) return <InterfaceFailure error={this.state.error} name={this.props.name} onBack={this.props.onBack} />;
    return this.props.children;
  }
}

export function InterfaceFailure({ error, name = 'Daggery', onBack }: { error: Error; name?: string; onBack?: () => void }) {
  function campaigns() {
    // Clear only the selected campaign, retaining the login and all saved campaign data.
    try { sessionStorage.removeItem('daggery:campaign'); } catch { /* Storage may be disabled. */ }
    window.location.reload();
  }
  return <section className="daggery-interface-error" role="alert">
    <p className="daggery-eyebrow">Something interrupted the interface</p>
    <h1>{name} could not load</h1>
    <p>Your campaign data is still saved. Reload the interface or return to your campaigns.</p>
    <div className="daggery-error-actions"><button type="button" className="daggery-primary" onClick={() => window.location.reload()}>Reload interface</button><button type="button" className="daggery-roll-toggle" onClick={onBack ?? campaigns}>{onBack ? 'Back to overview' : 'Back to campaigns'}</button></div>
    <details><summary>Error details</summary><pre>{error.message}</pre></details>
  </section>;
}
