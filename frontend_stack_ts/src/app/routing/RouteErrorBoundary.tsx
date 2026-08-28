import { Component } from "react"
import type { ErrorInfo, ReactNode } from "react"

import { Page } from "~/app/layouts/Page"
import { ErrorState } from "~/ui/patterns/ErrorState"

export type RouteErrorBoundaryProps = Readonly<{
  children: ReactNode
}>

type RouteErrorBoundaryState = Readonly<{
  failed: boolean
}>

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  public override state: RouteErrorBoundaryState = { failed: false }

  public static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true }
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Route render failed", error, info.componentStack)
  }

  private readonly reset = (): void => {
    this.setState({ failed: false })
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return (
        <Page width="default">
          <ErrorState variant="unknown" onRetry={this.reset} />
        </Page>
      )
    }
    return this.props.children
  }
}
