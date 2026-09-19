import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import type { ReactNode } from "react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RouteErrorBoundary } from "./components/ErrorBoundary";
import type { SectionKey } from "@/hooks/useUserRole";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Reservas from "./pages/Reservas";

import Espacios from "./pages/Espacios";
import Trabajadores from "./pages/Trabajadores";
import GestorCarta from "./pages/GestorCarta";
import Ecommerce from "./pages/Ecommerce";
import GestionWeb from "./pages/GestionWeb";
import GestionBot from "./pages/GestionBot";
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
const pagina = (contenido: ReactNode, requiredSection?: SectionKey) => (
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
            <Route path="/espacios" element={pagina(<Espacios />)} />
            <Route path="/trabajadores" element={pagina(<Trabajadores />)} />
            <Route path="/gestor-carta" element={pagina(<GestorCarta />)} />
            <Route path="/ecommerce" element={pagina(<Ecommerce />)} />
            <Route path="/gestion-web" element={pagina(<GestionWeb />)} />
            <Route path="/gestion-bot" element={pagina(<GestionBot />)} />
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
