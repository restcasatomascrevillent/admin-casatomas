import { completeAuditEnabled } from "@/lib/audit-version";
import { ESPERAS_REINTENTO_SESION_MS, esFalloTransitorioAuth, esperar } from "@/lib/reintentosSesion";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { emitirRevalidacionSesion } from "@/lib/revalidacion-sesion";
import { borrarCopiasLista } from "@/lib/facturas/copiaListaCompras";
import { activarCopiaHoy, borrarCopiaHoy } from "@/lib/cacheOffline";
import { borrarPermisosRecordados } from "@/lib/cachePermisos";
import { lanzarPrecargaHoy } from "@/lib/precargaSecciones";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import {
  limpiarAvisoSesionCaducada,
  marcarSesionCaducada,
} from "@/lib/aviso-sesion";

const signUpSchema = z.object({
  email: z.string().email("Email inválido").max(255),
  password: z.string().min(10, "La contraseña debe tener al menos 10 caracteres"),
  nombre_restaurante: z
    .string()
    .min(1, "El nombre del restaurante es requerido")
    .max(100),
  telefono: z.string().optional(),
});

const signInSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    nombre_restaurante: string,
    telefono?: string,
  ) => Promise<{ data?: unknown; error: Error | null }>;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ data?: unknown; error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type ErrorAuth = { status?: unknown; code?: unknown; name?: unknown } | null;

/** Código de Auth (GoTrue) cuando el usuario tiene el acceso bloqueado (ban). */
const CODIGO_BLOQUEO = "user_banned";
const MENSAJE_BLOQUEO =
  "Tu acceso al panel ha sido bloqueado. Contacta con el superadmin.";

function esBloqueoExplicito(error: ErrorAuth | undefined): boolean {
  return !!error && error.code === CODIGO_BLOQUEO;
}

/** Sin red o Auth caído: no dice nada de la sesión, no hay que cerrarla. */
function esFalloTransitorio(error: ErrorAuth | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  const status = Number(error.status);
  return !Number.isFinite(status) || status === 0 || status >= 500;
}

/** Error al registrar el acceso que viene de la red (sin código de PostgreSQL): se puede reintentar. */
class ErrorRedAuditoria extends Error {}

/**
 * Espera al registro mientras sigue vigente el token. Si falla, el llamador
 * debe avisar y no presentar el acceso como registrado correctamente.
 */
async function registrarAccesoAuditoria(accion: "acceso" | "logout") {
  if (!(await completeAuditEnabled())) {
    if (accion === "acceso") return; // servidor anterior: todavía no registra restauraciones
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("La sesión ya no es válida");
    const { error } = await supabase
      .from("audit_log")
      .insert({
        actor_user_id: user.id,
        actor_email: user.email,
        accion,
        user_agent: navigator.userAgent,
      });
    if (error)
      throw new Error("No se pudo registrar la salida en la auditoría");
    return;
  }
  const { error } = await supabase.rpc("registrar_acceso_panel", {
    p_tipo: accion,
    p_ruta: window.location.pathname,
  });
  if (error) {
    const mensaje = `No se pudo registrar ${accion} en la auditoría`;
    // Sin código de PostgreSQL: no llegó al servidor (red). Con código, el servidor dijo que no.
    throw (error as { code?: string }).code ? new Error(mensaje) : new ErrorRedAuditoria(mensaje);
  }
}

/** Registro del acceso con reintentos si falla por la red (poca cobertura). */
async function registrarAccesoConReintentos(esVigente: () => boolean): Promise<void> {
  for (let intento = 0; ; intento++) {
    try {
      await registrarAccesoAuditoria("acceso");
      return;
    } catch (e) {
      if (!(e instanceof ErrorRedAuditoria) || intento >= ESPERAS_REINTENTO_SESION_MS.length || !esVigente()) throw e;
      await esperar(ESPERAS_REINTENTO_SESION_MS[intento]);
    }
  }
}

/**
 * getUser() compartido (07/11/2026, login más rápido): al entrar se pedía 2-3
 * veces seguidas (INITIAL_SESSION + getSession, SIGNED_IN y la comprobación
 * inicial de bloqueo). Quien llega mientras hay una en vuelo espera a la misma;
 * no se guarda el resultado más allá de eso, salvo `ultimaValidacion`, que solo
 * usa la PRIMERA comprobación tras abrir la sesión (ver `comprobar`).
 */
type RespuestaGetUser = Awaited<ReturnType<typeof supabase.auth.getUser>>;
let getUserEnVuelo: Promise<RespuestaGetUser> | null = null;
let ultimaValidacion: { userId: string; t: number } | null = null;
/** Margen en el que la comprobación inicial reutiliza la validación recién hecha. */
const MARGEN_VALIDACION_MS = 2000;

function getUserCompartido(): Promise<RespuestaGetUser> {
  if (getUserEnVuelo) return getUserEnVuelo;
  const promesa = supabase.auth.getUser().then((r) => {
    if (r && !r.error && r.data?.user) ultimaValidacion = { userId: r.data.user.id, t: Date.now() };
    return r;
  });
  getUserEnVuelo = promesa;
  const soltar = () => {
    if (getUserEnVuelo === promesa) getUserEnVuelo = null;
  };
  promesa.then(soltar, soltar);
  return promesa;
}

/**
 * Conserva la REFERENCIA del usuario previo si es la misma persona (mismo id).
 *
 * supabase-js emite SIGNED_IN / TOKEN_REFRESHED cada vez que la pestaña o la
 * app vuelve a primer plano (p. ej. al volver de la cámara en la tablet), y
 * getUser() devuelve un objeto nuevo cada vez. Si se guardara tal cual, todo
 * lo que depende de la identidad de `user` (roles, super admin, efectos de
 * ProtectedRoute) se relanzaría con loading=true y desmontaría la página.
 * Solo un cambio real (otro id, o cambio de email) renueva la referencia.
 */
function conservarUsuario(
  previo: User | null,
  nuevo: User | null,
): User | null {
  if (
    previo &&
    nuevo &&
    previo.id === nuevo.id &&
    previo.email === nuevo.email
  ) {
    return previo;
  }
  return nuevo;
}

/**
 * Única suscripción a Supabase Auth para toda la app (2026-09-25).
 *
 * Antes, cada componente que llamaba a useAuth() creaba su propio
 * useState/useEffect: su propia suscripción a onAuthStateChange, su propio
 * getSession() y su propio getUser() (round-trip de red para validar el
 * token). En una sola carga de /dashboard, ProtectedRoute + useUserRole +
 * AppSidebar + useUserRole (otra vez) llamaban a useAuth() cuatro veces en
 * paralelo — cuatro peticiones de red independientes, cada una resolviendo
 * su propio `loading` en un momento distinto, disparando renders en
 * cascada. Eso era el lag y el parpadeo (la pantalla se quedaba en blanco
 * al entrar) al iniciar sesión, tanto en el Admin Panel como en el Super
 * Admin. Ahora el estado vive una sola vez aquí, en AuthProvider, y useAuth()
 * solo lee ese contexto: una suscripción, un getSession(), un getUser().
 */
export function AuthProvider({
  children,
  queryClient,
}: {
  children: ReactNode;
  /** Caché a vaciar al cerrar sesión o cambiar de usuario (CT-REM-FE-01). */
  queryClient?: QueryClient;
}) {
  const clienteConsultas = useRef(queryClient);
  clienteConsultas.current = queryClient;
  // Id del usuario cuya sesión pinta la app ahora (null = nadie).
  const idPintado = useRef<string | null>(null);
  /** Cancela y VACÍA la caché: invalidar no basta, serviría datos viejos en el primer render. */
  const vaciarCache = useCallback(() => {
    // También la copia de la lista de Compras guardada en el dispositivo, y la de «Hoy» (cacheOffline.ts).
    borrarCopiasLista();
    borrarCopiaHoy();
    // Y el rol y los permisos recordados (`cachePermisos.ts`).
    borrarPermisosRecordados();
    const qc = clienteConsultas.current;
    if (!qc) return;
    void qc.cancelQueries();
    qc.clear();
  }, []);
  /** Llamar justo ANTES de publicar el usuario nuevo (o null) en el estado. */
  const cambiarIdentidad = useCallback(
    (nuevoId: string | null) => {
      if (idPintado.current !== nuevoId) {
        // Salida (null) o usuario distinto: nada del anterior sobrevive.
        if (idPintado.current !== null || nuevoId === null) vaciarCache();
        idPintado.current = nuevoId;
      }
    },
    [vaciarCache],
  );
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Una entrada por sesión de página. Nunca se comparte entre dispositivos ni
  // usa localStorage para omitir accesos; refrescar el JWT no crea otro login.
  const accesos = useRef(new Map<string, Promise<void>>());
  const usuariosBloqueados = useRef(new Set<string>());
  // El usuario pulsó «Cerrar sesión»: su SIGNED_OUT no es una sesión caducada.
  const saliendoAMano = useRef(false);
  // Mientras se averigua si una sesión muerta es caducidad o bloqueo, el
  // SIGNED_OUT que emite Auth al fallar la renovación no decide el aviso.
  const decidiendoCierre = useRef(false);

  // «Hoy» sin cobertura (07/11/2026): con la sesión ya CONFIRMADA (no antes, para que otra cuenta no
  // vea la copia de la anterior) se carga la copia del día de este usuario y se mantiene al día. Al
  // salir o cambiar de usuario, `vaciarCache` la borra y esto deja de escribirla.
  const idUsuario = user?.id ?? null;
  useEffect(() => {
    const qc = clienteConsultas.current;
    if (!qc || !idUsuario) return;
    const parar = activarCopiaHoy(qc, idUsuario);
    // Abrir el panel en «Reservas › Hoy» (09/11/2026, mala cobertura): con la sesión confirmada y la copia
    // ya cargada, las lecturas de «Hoy» salen todas a la vez, sin esperar a rol y permisos ni al fichero de la
    // página. Solo la primera vez y solo si se arrancó en «Hoy» (`lib/precargaSecciones.ts`).
    lanzarPrecargaHoy(qc, { escritorio: window.innerWidth >= 768 });
    return parar;
  }, [idUsuario]);

  useEffect(() => {
    let isMounted = true;
    // Solo cuenta la validación más reciente: evita que una respuesta lenta
    // (getUser) de un evento anterior pise a la de uno posterior (p. ej.
    // SIGNED_OUT justo después de un SIGNED_IN).
    let ultimaSincronizacion = 0;

    const clearLocalSession = async () => {
      // Sesión guardada que ya no vale (p. ej. al volver al panel horas
      // después): es caducidad. El bloqueo solo se anuncia con señal explícita.
      if (!saliendoAMano.current) marcarSesionCaducada();
      cambiarIdentidad(null);
      await supabase.auth.signOut({ scope: "local" });
      if (!isMounted) return;
      setSession(null);
      setUser(null);
      setLoading(false);
    };

    const syncValidatedSession = async (incomingSession: Session | null) => {
      const miSincronizacion = ++ultimaSincronizacion;
      const esVigente = () =>
        isMounted && miSincronizacion === ultimaSincronizacion;

      if (!incomingSession) {
        accesos.current.clear();
        if (!esVigente()) return;
        // Auth cerró la sesión de quien estaba dentro sin que lo pidiera
        // (no se pudo renovar el token): vuelve al login avisando.
        if (
          idPintado.current !== null &&
          !saliendoAMano.current &&
          !decidiendoCierre.current
        )
          marcarSesionCaducada();
        cambiarIdentidad(null);
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      let { data: userData, error: userError } = await getUserCompartido();
      // Poca cobertura: se reintenta antes de dar la sesión por perdida.
      for (let intento = 0; userError && esFalloTransitorioAuth(userError) && intento < ESPERAS_REINTENTO_SESION_MS.length; intento++) {
        await esperar(ESPERAS_REINTENTO_SESION_MS[intento]);
        if (!esVigente()) return;
        ({ data: userData, error: userError } = await getUserCompartido());
      }
      if (!esVigente()) return;
      const status =
        typeof userError === "object" &&
        userError !== null &&
        "status" in userError
          ? Number((userError as { status?: unknown }).status)
          : null;

      if (esBloqueoExplicito(userError as ErrorAuth)) {
        // Auth confirma el bloqueo: se dice tal cual, no «sesión caducada».
        usuariosBloqueados.current.add(incomingSession.user.id);
        limpiarAvisoSesionCaducada();
        cambiarIdentidad(null);
        await supabase.auth.signOut({ scope: "local" });
        if (!isMounted) return;
        setSession(null);
        setUser(null);
        setLoading(false);
        toast.error(MENSAJE_BLOQUEO);
        return;
      }
      if (status === 401 || status === 403 || (!userData.user && !userError)) {
        await clearLocalSession();
        return;
      }

      if (userError) {
        // Solo conservar una sesión que ya ha registrado su entrada en esta
        // página; una sesión recién restaurada no puede saltarse la auditoría.
        if (!accesos.current.has(incomingSession.user.id)) {
          cambiarIdentidad(null);
          setSession(null);
          setUser(null);
          setLoading(false);
          toast.error(
            "No se pudo comprobar tu sesión: parece que no hay conexión. Cuando tengas cobertura, recarga la página.",
          );
          return;
        }
        setSession(incomingSession);
        setUser((previo) =>
          conservarUsuario(previo, incomingSession.user ?? null),
        );
        setLoading(false);
        return;
      }

      const userId = userData.user!.id;
      if (usuariosBloqueados.current.has(userId)) {
        cambiarIdentidad(null);
        await supabase.auth.signOut({ scope: "local" });
        if (!isMounted) return;
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }
      if (!accesos.current.has(userId))
        accesos.current.set(userId, registrarAccesoConReintentos(esVigente));
      try {
        await accesos.current.get(userId);
      } catch {
        accesos.current.delete(userId);
        if (esVigente()) {
          cambiarIdentidad(null);
          setSession(null);
          setUser(null);
          setLoading(false);
          toast.error(
            "No se pudo registrar el acceso al panel (¿sin conexión?). Cuando tengas cobertura, recarga la página.",
          );
        }
        return;
      }
      if (!esVigente()) return;
      saliendoAMano.current = false;
      // Otra cuenta en la misma pestaña: caché fuera ANTES de pintarla.
      cambiarIdentidad(userId);
      setSession(incomingSession);
      setUser((previo) => conservarUsuario(previo, userData.user));
      setLoading(false);
    };

    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, incomingSession) => {
      // Rol/permisos pueden haber cambiado: se releen sin recargar (FE-02).
      if (evento === "TOKEN_REFRESHED") emitirRevalidacionSesion();
      // Fuera del bloqueo de Auth: las RPC necesitan obtener el token actual.
      setTimeout(() => {
        if (isMounted) void syncValidatedSession(incomingSession);
      }, 0);
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncValidatedSession(session);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [cambiarIdentidad]);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let activo = true;
    let comprobando = false;
    let inicial = true;
    const cerrarPorBloqueo = async () => {
      if (!activo || usuariosBloqueados.current.has(userId)) return;
      usuariosBloqueados.current.add(userId);
      accesos.current.clear();
      limpiarAvisoSesionCaducada();
      cambiarIdentidad(null);
      // Retira inmediatamente la identidad: las rutas protegidas desmontan
      // el panel antes de esperar la limpieza del almacenamiento de Auth.
      setSession(null);
      setUser(null);
      toast.error(MENSAJE_BLOQUEO);
      await supabase.auth.signOut({ scope: "local" });
    };
    const cerrarPorCaducidad = async () => {
      if (!activo || usuariosBloqueados.current.has(userId)) return;
      accesos.current.clear();
      marcarSesionCaducada();
      cambiarIdentidad(null);
      setSession(null);
      setUser(null);
      await supabase.auth.signOut({ scope: "local" });
    };
    /**
     * Auth ya no acepta el token. Puede ser caducidad (no se renovó, la
     * sesión se cerró en el servidor) o un bloqueo. Se intenta renovar: si
     * funciona, la sesión sigue; si Auth responde `user_banned`, es bloqueo;
     * cualquier otro rechazo es una sesión caducada.
     */
    const decidirCierre = async () => {
      decidiendoCierre.current = true;
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session) return;
        if (esBloqueoExplicito(error as ErrorAuth)) await cerrarPorBloqueo();
        else if (!esFalloTransitorio(error as ErrorAuth))
          await cerrarPorCaducidad();
      } finally {
        decidiendoCierre.current = false;
      }
    };
    const comprobar = async () => {
      if (!activo || comprobando || document.visibilityState === "hidden")
        return;
      comprobando = true;
      try {
        // La primera comprobación llega justo después de que syncValidatedSession validara a este
        // mismo usuario: si fue hace menos de 2 s, no se repite la petición (el canal de bloqueos ya
        // está suscrito y el sondeo de 15 s sigue igual).
        if (
          inicial &&
          ultimaValidacion?.userId === userId &&
          Date.now() - ultimaValidacion.t < MARGEN_VALIDACION_MS
        ) {
          inicial = false;
          return;
        }
        const { error, data } = await getUserCompartido();
        if (esBloqueoExplicito(error as ErrorAuth)) {
          await cerrarPorBloqueo();
        } else if (
          error?.status === 401 ||
          error?.status === 403 ||
          (!error && !data.user)
        ) {
          await decidirCierre();
        } else if (!error) {
          // Sesión válida: reutiliza esta misma comprobación (15 s, foco y
          // visibilidad) para releer rol y permisos (CT-REM-FE-02). La
          // PRIMERA no: rol y permisos se acaban de leer al entrar este
          // usuario (UserRoleProvider) y se pedían dos veces seguidas.
          if (inicial) inicial = false;
          else emitirRevalidacionSesion();
        }
      } catch {
        /* Un corte de red no cierra una sesión válida. El servidor mantiene el bloqueo. */
      } finally {
        comprobando = false;
      }
    };
    const canal = supabase
      .channel(`user-access-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_access_status",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (
            "access_blocked" in payload.new &&
            payload.new.access_blocked === true
          )
            void cerrarPorBloqueo();
        },
      )
      .subscribe();
    // Respaldo si el canal se desconecta y al volver a la aplicación. La
    // comprobación inicial cubre un bloqueo durante la suscripción al canal.
    void comprobar();
    const timer = window.setInterval(() => void comprobar(), 15000);
    const alVolver = () => {
      void comprobar();
    };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      activo = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
      void supabase.removeChannel(canal);
    };
  }, [userId, cambiarIdentidad]);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      nombre_restaurante: string,
      telefono?: string,
    ) => {
      try {
        const validatedData = signUpSchema.parse({
          email,
          password,
          nombre_restaurante,
          telefono,
        });

        const redirectUrl = `${window.location.origin}/`;

        const { data, error } = await supabase.auth.signUp({
          email: validatedData.email,
          password: validatedData.password,
          options: {
            emailRedirectTo: redirectUrl,
            data: {
              nombre_restaurante: validatedData.nombre_restaurante,
              telefono: validatedData.telefono,
            },
          },
        });

        if (error) {
          if (error.message.includes("already registered")) {
            toast.error("Este email ya está registrado");
          } else {
            toast.error("Error al registrar: " + mensajeUsuario(error, "inténtalo de nuevo"));
          }
          return { error };
        }

        toast.success("Registro exitoso. Por favor verifica tu email.");
        return { data, error: null };
      } catch (error) {
        if (error instanceof z.ZodError) {
          toast.error(error.errors[0].message);
          return { error: new Error(error.errors[0].message) };
        }
        toast.error("Error inesperado al registrar");
        return { error: error as Error };
      }
    },
    [],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const validatedData = signInSchema.parse({ email, password });

      if (!(await completeAuditEnabled())) {
        // Compatibilidad durante la publicación: no se llama a una función
        // aún inexistente. La pantalla de auditoría avisa de la activación pendiente.
        const { data, error } = await supabase.auth.signInWithPassword({
          email: validatedData.email,
          password: validatedData.password,
        });
        if (error) {
          toast.error("Email o contraseña incorrectos");
          return { error };
        }
        if (!data.user)
          return { error: new Error("No se pudo abrir la sesión") };
        const { error: auditError } = await supabase.from("audit_log").insert({
          actor_user_id: data.user.id,
          actor_email: data.user.email,
          accion: "login",
          user_agent: navigator.userAgent,
        });
        if (auditError) {
          await supabase.auth.signOut({ scope: "local" });
          return {
            error: new Error("No se pudo registrar el acceso en auditoría"),
          };
        }
        limpiarAvisoSesionCaducada();
        toast.success("Sesión iniciada correctamente");
        return { data, error: null };
      }
      const response = await supabase.functions.invoke("panel-auth", {
        body: {
          email: validatedData.email,
          password: validatedData.password,
          ruta: window.location.pathname,
        },
      });
      if (response.error || !response.data?.session || !response.data?.user) {
        const context =
          response.error && "context" in response.error
            ? response.error.context
            : null;
        const detail =
          context instanceof Response
            ? await context.json().catch(() => null)
            : null;
        const error = new Error(
          detail?.error ??
            response.data?.error ??
            "No se pudo registrar y comprobar el acceso. Inténtalo de nuevo.",
        );
        toast.error(mensajeUsuario(error));
        return { error };
      }
      // El servidor ya ha guardado este acceso. Evita que SIGNED_IN lo duplique.
      const data = response.data;
      limpiarAvisoSesionCaducada();
      usuariosBloqueados.current.delete(data.user.id);
      accesos.current.set(data.user.id, Promise.resolve());
      const { error: sessionError } = await supabase.auth.setSession(
        data.session,
      );
      if (sessionError) {
        accesos.current.delete(data.user.id);
        toast.error(
          "El acceso se registró, pero no se pudo abrir la sesión. Inténtalo de nuevo.",
        );
        return { error: sessionError };
      }

      // Registrar inicio de sesión en BD de métricas
      try {
        supabase.functions.invoke("registrar-metrica", {
          body: {
            evento: "inicio_sesion",
            usuario_email: data.user?.email,
            usuario_id: data.user?.id,
            metadata: {
              timestamp: new Date().toISOString(),
              user_agent: navigator.userAgent,
            },
          },
        });
      } catch (e) {
        console.error("Error registrando métrica:", e);
      }

      toast.success("Sesión iniciada correctamente");

      return { data, error: null };
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return { error: new Error(error.errors[0].message) };
      }
      toast.error("Error inesperado al iniciar sesión");
      return { error: error as Error };
    }
  }, []);

  const signOut = useCallback(async () => {
    // Hay que leer quién es ANTES de cerrar sesión: `signOut()` invalida el
    // token, y la política de `audit_log` exige `actor_user_id = auth.uid()`
    // con el usuario todavía autenticado.
    const {
      data: { user: saliente },
    } = await supabase.auth.getUser();
    if (saliente) {
      try {
        await registrarAccesoAuditoria("logout");
      } catch (auditError) {
        toast.error(
          "No se pudo registrar el cierre de sesión. Vuelve a intentarlo.",
        );
        return { error: auditError as Error };
      }
    }

    // Solo ESTE dispositivo: por defecto Supabase cierra todas las sesiones
    // del usuario y los demás dispositivos verían su sesión terminada.
    saliendoAMano.current = true;
    limpiarAvisoSesionCaducada();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: unknown }).status)
          : null;

      // Si el token ya no es válido, limpiamos sesión local para evitar estado corrupto.
      if (status === 403) {
        await supabase.auth.signOut({ scope: "local" });
        cambiarIdentidad(null);
        toast.success("Sesión cerrada correctamente");
        return { error: null };
      }

      saliendoAMano.current = false;
      toast.error("Error al cerrar sesión: " + mensajeUsuario(error, "inténtalo de nuevo"));
      return { error };
    }
    accesos.current.clear();
    cambiarIdentidad(null);
    toast.success("Sesión cerrada correctamente");
    return { error: null };
  }, [cambiarIdentidad]);

  // Valor estable: solo cambia si cambia user/session/loading (los métodos son
  // estables), así los consumidores no se re-renderizan por nada más.
  const value = useMemo<AuthContextValue>(
    () => ({ user, session, loading, signUp, signIn, signOut }),
    [user, session, loading, signUp, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Id del usuario con sesión, o null; sin <AuthProvider> (pruebas) también null
 * en vez de lanzar. Para cachés por usuario (lista de Compras guardada).
 */
export const useUsuarioIdOpcional = (): string | null => useContext(AuthContext)?.user?.id ?? null;

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return context;
};
