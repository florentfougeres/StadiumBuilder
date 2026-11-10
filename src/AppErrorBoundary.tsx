import React from 'react';

/**
 * Last line of defence for the editor: an error thrown while rendering shows a way out instead of
 * a blank page. Projects are autosaved, so reloading brings back the last saved state.
 */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Editor crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-screen items-center justify-center bg-canvas p-6 text-center text-ink">
        <div className="max-w-md space-y-3">
          <p className="text-base font-semibold">L'éditeur a rencontré une erreur</p>
          <p className="text-xs text-ink-muted">
            Votre projet est enregistré automatiquement. Rechargez la page pour reprendre là où vous en étiez.
          </p>
          <p className="break-words text-xs text-ink-muted">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-accent-strong px-3 py-1.5 text-xs font-medium text-white"
          >
            Recharger
          </button>
        </div>
      </div>
    );
  }
}
