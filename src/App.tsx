import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SuperAdminRoute } from "./components/SuperAdminRoute";
import { RouteErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "@/hooks/useAuth";
import { UserRoleProvider } from "@/hooks/useUserRole";
import type { SectionKey } from "@/hooks/useUserRole";
import { SuperAdminProvider } from "@/hooks/useSuperAdmin";
import { AvisoTrabajosVideo } from "@/components/carta/potente/AvisoTrabajosVideo";
import { GestorRecortes } from "@/components/carta/recorte/GestorRecortes";
import { useVisualViewportVars } from "@/hooks/useVisualViewportVars";
import { ColaSubidaProvider } from "@/components/facturas/ColaSubidaProvider";
import { ColaVideosProvider } from "@/components/carta/video/ColaVideosProvider";
import { rutaServicios } from "@/components/servicios/pestanas";
import Auth from "./pages/Auth";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Reservas = lazy(() => import("./pages/Reservas"));
const Espacios = lazy(() => import("./pages/Espacios"));
const Ecommerce = lazy(() => import("./pages/Ecommerce"));
// Gestor Web unifica Carta, Novedades, Menús y Tapas en pestañas (?tab=...).
// La ruta antigua /gestor-carta redirige aquí; /gestion-bot redirige ahora a
// /super-admin/bot-web.
const GestionWeb = lazy(() => import("./pages/GestorWeb"));
const AsistenteTelefonico = lazy(() => import("./pages/AsistenteTelefonico"));
const Marketing = lazy(() => import("./pages/Marketing"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Cheques = lazy(() => import("./pages/Cheques"));
const Tienda = lazy(() => import("./pages/Tienda"));
const Facturas = lazy(() => import("./pages/Facturas"));
const Usuarios = lazy(() => import("./pages/Usuarios"));
const Ayuda = lazy(() => import("./pages/Ayuda"));
const GestorGasto = lazy(() => import("./pages/GestorGasto"));
const GestionResenas = lazy(() => import("./pages/GestionResenas"));
const TraficoWeb = lazy(() => import("./pages/TraficoWeb"));
const SuperAdminLogin = lazy(() => import("./pages/SuperAdminLogin"));
const SuperAdminPanel = lazy(() => import("./pages/SuperAdminPanel"));
const SuperAdminUsuarios = lazy(() => import("./pages/SuperAdminUsuarios"));
const SuperAdminBotWeb = lazy(() => import("./pages/SuperAdminBotWeb"));
const SuperAdminAuditoria = lazy(() => import("./pages/SuperAdminAuditoria"));
const SuperAdminServicios = lazy(() => import("./pages/SuperAdminServicios"));

const queryClient = new QueryClient();

/**
 * Páginas bajo demanda (01-11-2026): antes App importaba las ~25 páginas y
 * todo el panel (gráficas, editor de planos, llamadas de voz…) iba en un único
 * fichero de 3,7 MB que se bajaba entero en cualquier pantalla y otra vez con
 * cada despliegue. Ahora cada página es su propio fichero y se pide al
 * entrar; si tras un despliegue falta el de la versión anterior, la barrera de
 * errores recarga sola (ErrorBoundary › PATRON_CHUNK_OBSOLETO). El acceso
 * (Auth) sigue dentro del fichero inicial para salir al momento.
 */
function CargandoPagina() {
  return (
    <div className="flex min-h-app w-full items-center justify-center" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

const bajoDemanda = (contenido: ReactNode) => <Suspense fallback={<CargandoPagina />}>{contenido}</Suspense>;

/** Publica --vv-h/--vv-top/--vv-bottom (viewport visual, sin teclado) para diálogos y hojas en tablet. */
function VisualViewportVars() {
  useVisualViewportVars();
  return null;
}

/**
 * Barrera de errores de nivel página: cada ruta tiene la suya, ligada al pathname,
 * de modo que un fallo en Facturas no se lleva por delante Reservas y al navegar
 * a otra sección la barrera se resetea sola.
 */
const pagina = (contenido: ReactNode, requiredSection?: SectionKey | SectionKey[]) => (
  <RouteErrorBoundary>
    <ProtectedRoute requiredSection={requiredSection}>{bajoDemanda(contenido)}</ProtectedRoute>
  </RouteErrorBoundary>
);

// Ecommerce, Asistente Tel., Gestor Gasto, Reseñas Google, Tráfico web,
// Espacios y Bot Web viven exclusivamente bajo /super-admin/* (ver botón de
// engranaje en AppSidebar). Plantillas Email salió de aquí el 04/11/2026: es
// una subpestaña de Reservas › Configuración.
const paginaSuperAdmin = (contenido: ReactNode) => (
  <RouteErrorBoundary>
    <SuperAdminRoute>{bajoDemanda(contenido)}</SuperAdminRoute>
  </RouteErrorBoundary>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <VisualViewportVars />
    <AuthProvider queryClient={queryClient}>
      <UserRoleProvider>
        <SuperAdminProvider>
          <TooltipProvider>
            {/* Los toasts viven fuera de la barrera para seguir funcionando si el router falla. */}
            <Toaster />
            <BrowserRouter>
              {/* Cola de subida de facturas en segundo plano: por encima de las rutas
                  para que cambiar de sección no la cancele (05-oct-2026). */}
              <ColaSubidaProvider>
              {/* Cola de «Vídeo del plato»: se procesa en segundo plano y se guarda sola (01-11-2026). */}
              <ColaVideosProvider>
              {/* «Hay N vídeo(s) pendiente(s)…» de otros dispositivos: solo en los potentes; los
                  mete en la cola de arriba (docs/video-dispositivo-potente.md). */}
              <AvisoTrabajosVideo />
              {/* Recorte de fotos del móvil tras guardar: pestaña muerta a medias y refresco de la carta. */}
              <GestorRecortes />
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
                  {/* Sección "Personal" retirada el 2026-09-23 (decisión del dueño). Se
                      conserva la ruta para que marcadores/enlaces antiguos no den 404. */}
                  <Route path="/trabajadores" element={<Navigate to="/" replace />} />
                  <Route path="/gestion-web" element={pagina(<GestionWeb />)} />
                  <Route path="/gestor-carta" element={<Navigate to="/gestion-web?tab=carta" replace />} />
                  <Route path="/gestion-bot" element={<Navigate to="/super-admin/bot-web" replace />} />
                  <Route path="/marketing" element={pagina(<Marketing />)} />
                  <Route path="/cheques" element={pagina(<Cheques />, "cheques")} />
                  <Route path="/tienda" element={pagina(<Tienda />, "tienda")} />
                  <Route path="/facturas" element={pagina(<Facturas />)} />
                  <Route path="/usuarios" element={pagina(<Usuarios />, "usuarios")} />
                  {/* Centro de Ayuda: para todos los roles (sin sección de permisos). */}
                  <Route path="/ayuda" element={pagina(<Ayuda />)} />
                  <Route path="/super-admin/login" element={bajoDemanda(<SuperAdminLogin />)} />
                  <Route path="/super-admin" element={paginaSuperAdmin(<SuperAdminPanel />)} />
                  <Route path="/super-admin/ecommerce" element={paginaSuperAdmin(<Ecommerce />)} />
                  <Route path="/super-admin/asistente-telefonico" element={paginaSuperAdmin(<AsistenteTelefonico />)} />
                  <Route path="/super-admin/gestor-gasto" element={paginaSuperAdmin(<GestorGasto />)} />
                  {/* Costes es una pestaña de Servicios desde el 04/11/2026: la ruta vieja lleva a ella. */}
                  <Route path="/super-admin/costes" element={<Navigate to={rutaServicios("costes")} replace />} />
                  <Route path="/super-admin/resenas" element={paginaSuperAdmin(<GestionResenas />)} />
                  {/* Plantillas Email vive en Reservas › Configuración desde el 04/11/2026 (petición del dueño).
                      La ruta vieja se conserva para que marcadores y enlaces antiguos lleven allí. */}
                  <Route path="/super-admin/plantillas-email" element={<Navigate to="/reservas?tab=configuracion&sub=plantillas" replace />} />
                  <Route path="/super-admin/trafico-web" element={paginaSuperAdmin(<TraficoWeb />)} />
                  <Route path="/super-admin/espacios" element={paginaSuperAdmin(<Espacios />)} />
                  <Route path="/super-admin/bot-web" element={paginaSuperAdmin(<SuperAdminBotWeb />)} />
                  <Route path="/super-admin/usuarios" element={paginaSuperAdmin(<SuperAdminUsuarios />)} />
                  <Route path="/super-admin/auditoria" element={paginaSuperAdmin(<SuperAdminAuditoria />)} />
                  <Route path="/super-admin/servicios" element={paginaSuperAdmin(<SuperAdminServicios />)} />
                  <Route path="*" element={bajoDemanda(<NotFound />)} />
                </Routes>
              </RouteErrorBoundary>
              </ColaVideosProvider>
              </ColaSubidaProvider>
            </BrowserRouter>
          </TooltipProvider>
        </SuperAdminProvider>
      </UserRoleProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

