import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

interface State { error: Error | null }

/** A render error shows what broke and offers a reload, instead of an empty page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error)
      return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>printmax hit an error it could not recover from. Reloading usually fixes it; if it keeps happening, tell an administrator what you were doing.</p>
        <pre>{this.state.error.message}</pre>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
