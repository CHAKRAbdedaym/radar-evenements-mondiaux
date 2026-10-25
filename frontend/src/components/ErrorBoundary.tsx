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
      <div role="alert" className="error">
        Cette page n’a pas pu s’afficher ({this.state.error.message}).
        <button type="button" className="btn-text" onClick={() => this.setState({ error: null })}>
          Réessayer
        </button>
      </div>
    );
  }
}
