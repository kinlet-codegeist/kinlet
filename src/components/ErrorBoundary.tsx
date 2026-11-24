import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { gateway } from "../data/gateway";
import { BrandMark, Button } from "./ui";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "Kinlet view failed:",
      error.message,
      info.componentStack,
    );
  }
  render() {
    if (this.state.failed)
      return (
        <div className="app-error">
          <BrandMark size={42} />
          <h1>Kinlet could not load</h1>
          <p>
            Reload Kinlet to try again.
          </p>
          <div>
            <Button onClick={() => window.location.reload()}>
              Reload Kinlet
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                gateway.reset();
                window.location.hash = "/attention";
                window.location.reload();
              }}
            >
              Reset sample workspace
            </Button>
          </div>
        </div>
      );
    return this.props.children;
  }
}
