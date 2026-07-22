import React from 'react';

import RecoveryScreen from '../screens/recovery/screen';

type AppErrorBoundaryProps = {
  children?: React.ReactNode;
};

type AppErrorBoundaryState = {
  failed: boolean;
};

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {failed: false};

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return {failed: true};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Unexpected app render failure', error, info);
  }

  private readonly retry = (): void => {
    this.setState({failed: false});
  };

  render(): React.ReactNode {
    if (this.state.failed) {
      return <RecoveryScreen kind="unexpected" onRetry={this.retry} />;
    }
    return this.props.children;
  }
}
