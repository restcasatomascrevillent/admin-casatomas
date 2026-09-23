import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RouteErrorBoundary } from "./components/ErrorBoundary";
import type { SectionKey } from "@/hooks/useUserRole";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Reservas from "./pages/Reservas";
import PlantillasEmail from "./pages/PlantillasEmail";
import Espacios from "./pages/Espacios";
import Ecommerce from "./pages/Ecommerce";
// Gestor Web unifica Carta, Novedades, Menús, Tapas y Bot web en pestañas
// (?tab=...). Las rutas antiguas /gestor-carta y /gestion-bot redirigen aquí.
import GestionWeb from "./pages/GestorWeb";
import AsistenteTelefonico from "./pages/AsistenteTelefonico";
import Marketing from "./pages/Marketing";
import NotFound from "./pages/NotFound";
import Facturas from "./pages/Facturas";
import Usuarios from "./pages/Usuarios";
import GestorGasto from "./pages/GestorGasto";
import GestionResenas from "./pages/GestionResenas";

const queryClient = new QueryClient();

/**
 * Barrera de errores de nivel página: cada ruta tiene la suya, ligada al pathname,
 * de modo que un fallo en Facturas no se lleva por delante Reservas y al navegar
 * a otra sección la barrera se resetea sola.
 */
const pagina = (contenido: ReactNode, requiredSection?: SectionKey | SectionKey[]) => (
  <RouteErrorBoundary>
    <ProtectedRoute requiredSection={requiredSection}>{contenido}</ProtectedRoute>
  </RouteErrorBoundary>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      {/* Los toasts viven fuera de la barrera para seguir funcionando si el router falla. */}
      <Toaster />
      <Sonner />
      <BrowserRouter>
        {/* Barrera de nivel app: último recurso para que nunca quede la pantalla en blanco. */}
        <RouteErrorBoundary
          pantallaCompleta
          titulo="El panel ha sufrido un error inesperado"
          descripcion="No se ha podido mostrar la aplicación. No se ha perdido ningún dato guardado. Pulsa «Reintentar» para volver a cargar la pantalla o «Recargar página» si el problema persiste."
        >
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={pagina(<Dashboard />)} />
            <Route path="/dashboard" element={pagina(<Dashboard />)} />
            <Route path="/reservas" element={pagina(<Reservas />)} />
            <Route path="/plantillas-email" element={pagina(<PlantillasEmail />, "reservas")} />
            <Route path="/espacios" element={pagina(<Espacios />)} />
            {/* Sección "Personal" retirada el 2026-09-23 (decisión del dueño). Se
                conserva la ruta para que marcadores/enlaces antiguos no den 404. */}
            <Route path="/trabajadores" element={<Navigate to="/" replace />} />
            <Route path="/ecommerce" element={pagina(<Ecommerce />)} />
            <Route path="/gestion-web" element={pagina(<GestionWeb />)} />
            <Route path="/gestor-carta" element={<Navigate to="/gestion-web?tab=carta" replace />} />
            <Route path="/gestion-bot" element={<Navigate to="/gestion-web?tab=bot" replace />} />
            <Route path="/asistente-telefonico" element={pagina(<AsistenteTelefonico />)} />
            <Route path="/marketing" element={pagina(<Marketing />)} />
            <Route path="/facturas" element={pagina(<Facturas />)} />
            <Route path="/usuarios" element={pagina(<Usuarios />, "usuarios")} />
            <Route path="/gestor-gasto" element={pagina(<GestorGasto />)} />
            <Route path="/resenas" element={pagina(<GestionResenas />)} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </RouteErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
