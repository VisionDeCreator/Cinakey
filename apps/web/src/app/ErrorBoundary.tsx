import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error boundary", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
          <h1 className="text-lg font-semibold text-zinc-100">
            Something went wrong
          </h1>
          <p className="text-sm text-zinc-500">
            {this.state.error.message || "Unexpected error"}
          </p>
          <Button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.assign("/projects");
            }}
          >
            Back to projects
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
