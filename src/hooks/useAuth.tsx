import { completeAuditEnabled } from "@/lib/audit-version";
import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";

const signUpSchema = z.object({
  email: z.string().email("Email inválido").max(255),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  nombre_restaurante: z.string().min(1, "El nombre del restaurante es requerido").max(100),
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
    telefono?: string
  ) => Promise<{ data?: unknown; error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ data?: unknown; error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Espera al registro mientras sigue vigente el token. Si falla, el llamador
 * debe avisar y no presentar el acceso como registrado correctamente.
 */
async function registrarAccesoAuditoria(accion: "acceso" | "logout") {
  if (!await completeAuditEnabled()) {
    if (accion === "acceso") return; // servidor anterior: todavía no registra restauraciones
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("La sesión ya no es válida");
    const { error } = await supabase.from("audit_log").insert({ actor_user_id: user.id, actor_email: user.email, accion, user_agent: navigator.userAgent });
    if (error) throw new Error("No se pudo registrar la salida en la auditoría");
    return;
  }
  const { error } = await supabase.rpc("registrar_acceso_panel", {
    p_tipo: accion, p_ruta: window.location.pathname,
  });
  if (error) throw new Error(`No se pudo registrar ${accion} en la auditoría`);
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
function conservarUsuario(previo: User | null, nuevo: User | null): User | null {
  if (previo && nuevo && previo.id === nuevo.id && previo.email === nuevo.email) {
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
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Una entrada por sesión de página. Nunca se comparte entre dispositivos ni
  // usa localStorage para omitir accesos; refrescar el JWT no crea otro login.
  const accesos = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    let isMounted = true;
    // Solo cuenta la validación más reciente: evita que una respuesta lenta
    // (getUser) de un evento anterior pise a la de uno posterior (p. ej.
    // SIGNED_OUT justo después de un SIGNED_IN).
    let ultimaSincronizacion = 0;

    const clearLocalSession = async () => {
      await supabase.auth.signOut({ scope: "local" });
      if (!isMounted) return;
      setSession(null);
      setUser(null);
      setLoading(false);
    };

    const syncValidatedSession = async (incomingSession: Session | null) => {
      const miSincronizacion = ++ultimaSincronizacion;
      const esVigente = () => isMounted && miSincronizacion === ultimaSincronizacion;

      if (!incomingSession) {
        accesos.current.clear();
        if (!esVigente()) return;
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!esVigente()) return;
      const status = typeof userError === "object" && userError !== null && "status" in userError
        ? Number((userError as { status?: unknown }).status)
        : null;

      if ((status === 401 || status === 403) || (!userData.user && !userError)) {
        await clearLocalSession();
        return;
      }

      if (userError) {
        // Solo conservar una sesión que ya ha registrado su entrada en esta
        // página; una sesión recién restaurada no puede saltarse la auditoría.
        if (!accesos.current.has(incomingSession.user.id)) {
          setSession(null); setUser(null); setLoading(false);
          toast.error("No se pudo verificar y registrar el acceso. Recarga la página para reintentarlo.");
          return;
        }
        setSession(incomingSession);
        setUser((previo) => conservarUsuario(previo, incomingSession.user ?? null));
        setLoading(false);
        return;
      }

      const userId = userData.user!.id;
      if (!accesos.current.has(userId)) accesos.current.set(userId, registrarAccesoAuditoria("acceso"));
      try { await accesos.current.get(userId); }
      catch {
        accesos.current.delete(userId);
        if (esVigente()) {
          setSession(null); setUser(null); setLoading(false);
          toast.error("No se pudo registrar el acceso al panel. Recarga la página para reintentarlo.");
        }
        return;
      }
      if (!esVigente()) return;
      setSession(incomingSession);
      setUser((previo) => conservarUsuario(previo, userData.user));
      setLoading(false);
    };

    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, incomingSession) => {
      // Fuera del bloqueo de Auth: las RPC necesitan obtener el token actual.
      setTimeout(() => { if (isMounted) void syncValidatedSession(incomingSession); }, 0);
    });

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncValidatedSession(session);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    nombre_restaurante: string,
    telefono?: string
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
          toast.error("Error al registrar: " + error.message);
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
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const validatedData = signInSchema.parse({ email, password });

      if (!await completeAuditEnabled()) {
        // Compatibilidad durante la publicación: no se llama a una función
        // aún inexistente. La pantalla de auditoría avisa de la activación pendiente.
        const { data, error } = await supabase.auth.signInWithPassword({ email: validatedData.email, password: validatedData.password });
        if (error) { toast.error("Email o contraseña incorrectos"); return { error }; }
        if (!data.user) return { error: new Error("No se pudo abrir la sesión") };
        const { error: auditError } = await supabase.from("audit_log").insert({
          actor_user_id: data.user.id, actor_email: data.user.email, accion: "login", user_agent: navigator.userAgent,
        });
        if (auditError) { await supabase.auth.signOut({ scope: "local" }); return { error: new Error("No se pudo registrar el acceso en auditoría") }; }
        toast.success("Sesión iniciada correctamente");
        return { data, error: null };
      }
      const response = await supabase.functions.invoke("panel-auth", {
        body: { email: validatedData.email, password: validatedData.password, ruta: window.location.pathname },
      });
      if (response.error || !response.data?.session || !response.data?.user) {
        const context = response.error && "context" in response.error ? response.error.context : null;
        const detail = context instanceof Response ? await context.json().catch(() => null) : null;
        const error = new Error(detail?.error ?? response.data?.error ?? "No se pudo registrar y comprobar el acceso. Inténtalo de nuevo.");
        toast.error(error.message);
        return { error };
      }
      // El servidor ya ha guardado este acceso. Evita que SIGNED_IN lo duplique.
      const data = response.data;
      accesos.current.set(data.user.id, Promise.resolve());
      const { error: sessionError } = await supabase.auth.setSession(data.session);
      if (sessionError) {
        accesos.current.delete(data.user.id);
        toast.error("El acceso se registró, pero no se pudo abrir la sesión. Inténtalo de nuevo.");
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
    const { data: { user: saliente } } = await supabase.auth.getUser();
    if (saliente) {
      try { await registrarAccesoAuditoria("logout"); }
      catch (auditError) {
        toast.error("No se pudo registrar el cierre de sesión. Vuelve a intentarlo.");
        return { error: auditError as Error };
      }
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : null;

      // Si el token ya no es válido, limpiamos sesión local para evitar estado corrupto.
      if (status === 403) {
        await supabase.auth.signOut({ scope: "local" });
        toast.success("Sesión cerrada correctamente");
        return { error: null };
      }

      toast.error("Error al cerrar sesión: " + error.message);
      return { error };
    }
    accesos.current.clear();
    toast.success("Sesión cerrada correctamente");
    return { error: null };
  }, []);

  // Valor estable: solo cambia si cambia user/session/loading (los métodos son
  // estables), así los consumidores no se re-renderizan por nada más.
  const value = useMemo<AuthContextValue>(
    () => ({ user, session, loading, signUp, signIn, signOut }),
    [user, session, loading, signUp, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return context;
};
