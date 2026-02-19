import { Component, type ReactNode, type ErrorInfo } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary to catch rendering errors in child components.
 * Prevents entire game UI from crashing when a single component fails.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.85)",
            color: "#fff",
            fontFamily: "system-ui, sans-serif",
            padding: "24px",
            zIndex: 9999,
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: "24px" }}>
            Something went wrong
          </h2>
          <p style={{ margin: "0 0 8px", color: "#aaa", textAlign: "center" }}>
            The game UI encountered an error. The game world continues to run in
            the background.
          </p>
          <p
            style={{
              margin: "0 0 24px",
              color: "#888",
              fontSize: "12px",
              maxWidth: "400px",
              textAlign: "center",
            }}
          >
            {this.state.error?.message || "Unknown error"}
          </p>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={this.handleRetry}
              style={{
                padding: "12px 24px",
                fontSize: "16px",
                backgroundColor: "#4a7c59",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "12px 24px",
                fontSize: "16px",
                backgroundColor: "#555",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
