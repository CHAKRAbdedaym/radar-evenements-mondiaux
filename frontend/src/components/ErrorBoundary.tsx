import { Component, type ErrorInfo, type ReactNode } from "react";

/** Keeps the app shell alive if one page throws while rendering. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="panel p-6 text-center">
        <p className="font-display text-lg font-semibold text-alert">⚠ Cette page a rencontré une erreur d'affichage</p>
        <p className="mt-2 text-sm text-ink-3">{this.state.error.message}</p>
        <button className="btn mt-4" onClick={() => this.setState({ error: null })}>
          Réessayer
        </button>
      </div>
    );
  }
}
