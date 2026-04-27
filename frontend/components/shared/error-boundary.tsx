"use client";

/**
 * ErrorBoundary — class-based React error boundary genérico.
 *
 * Aísla árboles de UI para que un error en un widget (e.g. un chart con data
 * malformada) no rompa el dashboard entero. Wrappear cada Surface "pesada"
 * con esto. Para errores de query usar el `query.isError` del hook —
 * los errores de fetch llegan ahí, no a este boundary.
 */
import * as React from "react";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

interface State {
  hasError: boolean;
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // En prod conectar a Sentry/Logtail. Por ahora solo console.
    console.error("ErrorBoundary caught", error, info);
  }

  reset = (): void => this.setState({ hasError: false, error: null });

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <Surface className="border border-negative/20 bg-negative/5">
            <Surface.Header>
              <Surface.Title className="text-negative">Algo falló</Surface.Title>
              <Surface.Subtitle>
                {this.state.error?.message ?? "Error desconocido"}
              </Surface.Subtitle>
            </Surface.Header>
            <Surface.Body>
              <Button variant="outline" onClick={this.reset}>
                Reintentar
              </Button>
            </Surface.Body>
          </Surface>
        )
      );
    }
    return this.props.children;
  }
}
