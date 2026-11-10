import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SuperAdminRoute } from "./components/SuperAdminRoute";
import { RouteErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "@/hooks/useAuth";
import { UserRoleProvider } from "@/hooks/useUserRole";
import type { SectionKey } from "@/hooks/useUserRole";
import { SuperAdminProvider } from "@/hooks/useSuperAdmin";
import { GestorRecortes } from "@/components/carta/recorte/GestorRecortes";
import { useVisualViewportVars } from "@/hooks/useVisualViewportVars";
import { ColaSubidaProvider } from "@/components/facturas/ColaSubidaProvider";
import { ColaVideosProvider } from "@/components/carta/video/ColaVideosProvider";
import { rutaServicios } from "@/components/servicios/pestanas";
import { PanelLayout, CargandoContenido } from "@/components/PanelLayout";
import { CARGADORES_SECCION, prepararArranqueEnHoy } from "@/lib/precargaSecciones";
import Auth from "./pages/Auth";
const Dashboard = lazy(CARGADORES_SECCION["/dashboard"]);
const Reservas = lazy(CARGADORES_SECCION["/reservas"]);
const Espacios = lazy(() => import("./pages/Espacios"));
const Ecommerce = lazy(() => import("./pages/Ecommerce"));
// Gestor Web unifica Carta, Novedades, Menús y Tapas en pestañas (?tab=...).
// La ruta antigua /gestor-carta redirige aquí; /gestion-bot redirige ahora a
// /super-admin/bot-web.
const GestionWeb = lazy(CARGADORES_SECCION["/gestion-web"]);
const AsistenteTelefonico = lazy(() => import("./pages/AsistenteTelefonico"));
const Marketing = lazy(CARGADORES_SECCION["/marketing"]);
const RRSS = lazy(CARGADORES_SECCION["/rrss"]);
const InstagramRapido = lazy(() => import("./pages/InstagramRapido"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Cheques = lazy(CARGADORES_SECCION["/cheques"]);
const Tienda = lazy(CARGADORES_SECCION["/tienda"]);
const Facturas = lazy(CARGADORES_SECCION["/facturas"]);
const Albaranes = lazy(CARGADORES_SECCION["/albaranes"]);
const AnalisisGeneral = lazy(CARGADORES_SECCION["/analisis"]);
const Usuarios = lazy(CARGADORES_SECCION["/usuarios"]);
const Ayuda = lazy(CARGADORES_SECCION["/ayuda"]);
const Avisos = lazy(CARGADORES_SECCION["/avisos"]);
const GestorGasto = lazy(() => import("./pages/GestorGasto"));
const GestionResenas = lazy(() => import("./pages/GestionResenas"));
const TraficoWeb = lazy(() => import("./pages/TraficoWeb"));
const SuperAdminLogin = lazy(() => import("./pages/SuperAdminLogin"));
const SuperAdminPanel = lazy(() => import("./pages/SuperAdminPanel"));
const SuperAdminUsuarios = lazy(() => import("./pages/SuperAdminUsuarios"));
const SuperAdminBotWeb = lazy(() => import("./pages/SuperAdminBotWeb"));
const SuperAdminAuditoria = lazy(() => import("./pages/SuperAdminAuditoria"));
const SuperAdminServicios = lazy(() => import("./pages/SuperAdminServicios"));
const SuperAdminLogs = lazy(() => import("./pages/SuperAdminLogs"));

/**
 * Valores por defecto pensados para la red mala del local (07/11/2026, «Hoy» desde el móvil):
 *   · `staleTime` 30 s: volver a una pantalla (o cambiar Kanban ↔ Plano) no repite lo que se acaba de pedir.
 *   · `retry` 2 con espera creciente y acotada (1 s, 2 s… máx. 8 s), en vez de 3.
 *   · `refetchOnWindowFocus`: sí, pero solo lo que ya está viejo (respeta `staleTime`).
 *   · `networkMode: "offlineFirst"`: sin red se pinta lo que hay en caché (o la copia del día,
 *     `lib/cacheOffline.ts`) y la petición espera a que vuelva la red en vez de quedarse colgada.
 * Las pruebas crean su propio `QueryClient`: esto no las afecta.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      retryDelay: (intento) => Math.min(1_000 * 2 ** intento, 8_000),
      refetchOnWindowFocus: true,
      networkMode: "offlineFirst",
    },
  },
});

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

/**
 * «Reservas › Hoy» con mala cobertura (09/11/2026): si el panel se abre en «Hoy», el fichero de Reservas y
 * el de la precarga empiezan a bajar YA, a la vez que se valida la sesión (`lib/precargaSecciones.ts`); con la
 * sesión confirmada, `AuthProvider` lanza las lecturas de «Hoy».
 */
if (typeof window !== "undefined") prepararArranqueEnHoy();

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
    <ProtectedRoute requiredSection={requiredSection}>
      {/* Dentro del marco del panel (PanelLayout): el «Cargando» va solo en la zona de contenido. */}
      <Suspense fallback={<CargandoContenido />}>{contenido}</Suspense>
    </ProtectedRoute>
  </RouteErrorBoundary>
);

/** Página protegida SIN el marco del panel (pantalla completa, p. ej. /instagram/rapido). */
const paginaSinMarco = (contenido: ReactNode, requiredSection?: SectionKey | SectionKey[]) => (
  <RouteErrorBoundary>
    <ProtectedRoute requiredSection={requiredSection}>{bajoDemanda(contenido)}</ProtectedRoute>
  </RouteErrorBoundary>
);

/**
 * Marco del panel (07/11/2026): menú lateral y cabecera montados UNA vez para todas las secciones; al navegar
 * solo cambia el contenido. `requiredSection={[]}` = solo sesión (cargando a pantalla completa y, sin usuario,
 * a /auth); el permiso de cada sección lo sigue comprobando su ruta con `pagina()`.
 */
const marcoPanel = (
  <RouteErrorBoundary>
    <ProtectedRoute requiredSection={[]}>
      <PanelLayout />
    </ProtectedRoute>
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

/** /instagram (sección antigua) → /rrss?red=instagram conservando tab, encargo, pieza… */
function RedirigirInstagram() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("red", "instagram");
  return <Navigate to={`/rrss?${p.toString()}`} replace />;
}

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
              {/* El aviso «Hay N vídeo(s) pendiente(s)…» (AvisoTrabajosVideo) se quitó el
                  06/11/2026 a petición del dueño, igual que el de las fotos pendientes de recortar. */}
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
                  {/* Secciones con menú: un solo marco (PanelLayout) para todas. */}
                  <Route element={marcoPanel}>
                    <Route path="/" element={pagina(<Dashboard />)} />
                    <Route path="/dashboard" element={pagina(<Dashboard />)} />
                    <Route path="/reservas" element={pagina(<Reservas />)} />
                    <Route path="/gestion-web" element={pagina(<GestionWeb />)} />
                    <Route path="/marketing" element={pagina(<Marketing />)} />
                    {/* RRSS (08/11/2026): Instagram, Facebook y el editor IA. Antes «Instagram» (sección propia desde el
                        05/11/2026). Sección de permisos «marketing» (la agencia, solo Instagram › Encargos). */}
                    <Route path="/rrss" element={pagina(<RRSS />)} />
                    <Route path="/cheques" element={pagina(<Cheques />, "cheques")} />
                    <Route path="/tienda" element={pagina(<Tienda />, "tienda")} />
                    <Route path="/facturas" element={pagina(<Facturas />)} />
                    {/* «Pregúntale a la IA» a pantalla completa (06/11/2026): la MISMA página de Facturas
                        (mismo árbol, no se desmonta al ir y volver). La IA exige «Editar»: sin él, la
                        página vuelve a /facturas (con solo «Facturas · Subida», a Cargar). */}
                    <Route path="/facturas/ia" element={pagina(<Facturas />, ["facturas", "facturas_subida"])} />
                    {/* «Análisis general» (07/11/2026): sección propia con los permisos de Facturas (solo «Ver», no Subida). */}
                    <Route path="/analisis" element={pagina(<AnalisisGeneral />, "facturas")} />
                    {/* «Subir albaranes» (10/11/2026): tipo de usuario «Albaranes» («Facturas · Solo fotos»), pensada para el móvil. */}
                    <Route path="/albaranes" element={pagina(<Albaranes />, "facturas_albaranes")} />
                    <Route path="/usuarios" element={pagina(<Usuarios />, "usuarios")} />
                    {/* Centro de Ayuda: para todos los roles (sin sección de permisos). */}
                    {/* Historial de avisos (campana): para todos los roles. */}
                    <Route path="/avisos" element={pagina(<Avisos />)} />
                    <Route path="/ayuda" element={pagina(<Ayuda />)} />
                  </Route>
                  {/* Redirecciones de rutas antiguas (fuera del marco, como antes). */}
                  {/* Sección "Personal" retirada el 2026-09-23 (decisión del dueño). Se
                      conserva la ruta para que marcadores/enlaces antiguos no den 404. */}
                  <Route path="/trabajadores" element={<Navigate to="/" replace />} />
                  <Route path="/gestor-carta" element={<Navigate to="/gestion-web?tab=carta" replace />} />
                  {/* /instagram?tab=…&encargo=… (marcadores, avisos push, notificar-video) → RRSS › Instagram con los mismos parámetros. */}
                  <Route path="/instagram" element={<RedirigirInstagram />} />
                  <Route path="/gestion-bot" element={<Navigate to="/super-admin/bot-web" replace />} />
                  {/* Sin menú, a pantalla completa (fuera del marco): */}
                  {/* Acceso directo para la pantalla de inicio del móvil: asistente rápido a pantalla completa (docs/instagram-movil.md). */}
                  <Route path="/instagram/rapido" element={paginaSinMarco(<InstagramRapido />, "marketing")} />
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
                  <Route path="/super-admin/logs" element={paginaSuperAdmin(<SuperAdminLogs />)} />
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

