import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Home, RefreshCw, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Titular del fallback. */
  titulo?: string;
  /** Explicación de qué ha pasado y cómo recuperarse. */
  descripcion?: string;
  /** Etiqueta para el log (ruta o nombre de la zona protegida). */
  contexto?: string;
  /** Al cambiar este valor el boundary se resetea solo (normalmente, la ruta actual). */
  resetKey?: string | number;
  /** Ocupa toda la pantalla (barrera de nivel app) en vez de solo el contenido. */
  pantallaCompleta?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  /** Se incrementa en cada reintento para forzar el remontaje de los hijos. */
  intento: number;
}

/**
 * Barrera de errores de render. Sin ella, cualquier excepción durante el render
 * desmonta todo el árbol de React y deja el panel en blanco.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null, intento: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const contexto = this.props.contexto ? ` [${this.props.contexto}]` : "";
    console.error(`[ErrorBoundary]${contexto} Error no controlado durante el render:`, error, errorInfo.componentStack);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Al navegar a otra sección se limpia el error para no dejar al usuario atrapado.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reintentar();
    }
  }

  reintentar = () => {
    this.setState((estado) => ({ error: null, componentStack: null, intento: estado.intento + 1 }));
  };

  render() {
    const { error, componentStack, intento } = this.state;
    const { children, titulo, descripcion, pantallaCompleta } = this.props;

    if (!error) {
      // La `key` fuerza un remontaje limpio de los hijos al pulsar "Reintentar".
      return <Fragment key={intento}>{children}</Fragment>;
    }

    return (
      <div
        className={`flex w-full items-center justify-center p-3 sm:p-6 ${pantallaCompleta ? "min-h-screen bg-background" : "min-h-[50vh]"}`}
      >
        <Card className="w-full max-w-2xl border-destructive/40">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <CardTitle className="text-lg sm:text-xl">{titulo ?? "Esta sección no se ha podido cargar"}</CardTitle>
            </div>
            <CardDescription>
              {descripcion ??
                "Ha ocurrido un error inesperado al mostrar el contenido. No se ha perdido ningún dato guardado. Pulsa «Reintentar» para volver a cargar esta sección, o cambia de sección desde el menú lateral."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Detalle técnico</AlertTitle>
              <AlertDescription className="break-words font-mono text-xs">
                {error.message || error.name || "Error desconocido"}
              </AlertDescription>
            </Alert>

            {import.meta.env.DEV && (error.stack || componentStack) && (
              <details className="rounded-md border border-border bg-muted/50 p-3">
                <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground">
                  Traza completa (solo en desarrollo)
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {[error.stack, componentStack].filter(Boolean).join("\n")}
                </pre>
              </details>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={this.reintentar} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Reintentar
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Recargar página
              </Button>
              <Button variant="ghost" onClick={() => window.location.assign("/")} className="gap-2">
                <Home className="h-4 w-4" />
                Volver al inicio
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}

/**
 * Barrera ligada a la ruta actual: se resetea sola al navegar a otra sección,
 * de modo que un fallo en una página no impide usar el resto del panel.
 */
export function RouteErrorBoundary({ children, ...props }: Omit<ErrorBoundaryProps, "resetKey" | "contexto">) {
  const { pathname } = useLocation();

  return (
    <ErrorBoundary resetKey={pathname} contexto={pathname} {...props}>
      {children}
    </ErrorBoundary>
  );
}
