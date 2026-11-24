import "@fontsource-variable/inter";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initializeRuntime } from "./platform/runtime";
import "./styles/app.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <main className="app-error" aria-live="polite">
    <h1>Loading Kinlet</h1>
  </main>,
);

initializeRuntime()
  .then(() => {
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(
      <main className="app-error" role="alert">
        <h1>Couldn’t open Kinlet in Jira</h1>
        <p>
          {error instanceof Error
            ? error.message
            : "The Jira connection is unavailable."}
        </p>
        <p>
          Reopen Kinlet from your Jira project, or retry the connection.
        </p>
        <button
          className="button button-primary"
          onClick={() => window.location.reload()}
        >
          Retry connection
        </button>
      </main>,
    );
  });
