import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from "react";
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
 * Escribe una fila de acceso en `audit_log` (login/logout). "Best effort":
 * un fallo aquí nunca debe romper el inicio/cierre de sesión en sí, así que
 * solo se registra en consola.
 */
async function registrarAccesoAuditoria(accion: "login" | "logout", userId: string, email: string | null) {
  try {
    const { error } = await supabase.from("audit_log").insert({
      actor_user_id: userId,
      actor_email: email,
      accion,
      user_agent: navigator.userAgent,
    });
    if (error) console.error(`Error registrando ${accion} en audit_log:`, error);
  } catch (e) {
    console.error(`Error registrando ${accion} en audit_log:`, e);
  }
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
        // Si hay un fallo temporal de red/servicio, mantenemos la sesión local.
        setSession(incomingSession);
        setUser((previo) => conservarUsuario(previo, incomingSession.user ?? null));
        setLoading(false);
        return;
      }

      setSession(incomingSession);
      setUser((previo) => conservarUsuario(previo, userData.user));
      setLoading(false);
    };

    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, incomingSession) => {
      void syncValidatedSession(incomingSession);
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

      const { data, error } = await supabase.auth.signInWithPassword({
        email: validatedData.email,
        password: validatedData.password,
      });

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          toast.error("Email o contraseña incorrectos");
        } else {
          toast.error("Error al iniciar sesión: " + error.message);
        }
        return { error };
      }

      toast.success("Sesión iniciada correctamente");

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

      // Rastro de auditoría para el super admin (tabla `audit_log`, ver
      // /super-admin/auditoria). Independiente de `registrar-metrica` de
      // arriba: esa va a la BD de métricas aparte y cuenta logins como
      // número, esta es la fila legible ("quién entró y cuándo") que lee
      // el super admin.
      if (data.user) void registrarAccesoAuditoria("login", data.user.id, data.user.email ?? null);

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
    if (saliente) void registrarAccesoAuditoria("logout", saliente.id, saliente.email ?? null);

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
