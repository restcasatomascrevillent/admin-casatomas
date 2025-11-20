import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Reservas from "./pages/Reservas";
import ReservaPublica from "./pages/ReservaPublica";
import ReservaConfirmacion from "./pages/ReservaConfirmacion";
import Salas from "./pages/Salas";
import Espacios from "./pages/Espacios";
import Analisis from "./pages/Analisis";
import Trabajadores from "./pages/Trabajadores";
import GestorCarta from "./pages/GestorCarta";
import GestionWeb from "./pages/GestionWeb";
import Marketing from "./pages/Marketing";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/reservar" element={<ReservaPublica />} />
        <Route path="/reserva-confirmacion" element={<ReservaConfirmacion />} />
        <Route
          path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reservas"
            element={
              <ProtectedRoute>
                <Reservas />
              </ProtectedRoute>
            }
          />
          <Route
            path="/salas"
            element={
              <ProtectedRoute>
                <Salas />
              </ProtectedRoute>
            }
          />
          <Route
            path="/espacios"
            element={
              <ProtectedRoute>
                <Espacios />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analisis"
            element={
              <ProtectedRoute>
                <Analisis />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trabajadores"
            element={
              <ProtectedRoute>
                <Trabajadores />
              </ProtectedRoute>
            }
          />
          <Route
            path="/gestor-carta"
            element={
              <ProtectedRoute>
                <GestorCarta />
              </ProtectedRoute>
            }
          />
          <Route
            path="/gestion-web"
            element={
              <ProtectedRoute>
                <GestionWeb />
              </ProtectedRoute>
            }
          />
          <Route
            path="/marketing"
            element={
              <ProtectedRoute>
                <Marketing />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
