import { useState, useEffect } from "react";
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

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const clearLocalSession = async () => {
      await supabase.auth.signOut({ scope: "local" });
      if (!isMounted) return;
      setSession(null);
      setUser(null);
      setLoading(false);
    };

    const syncValidatedSession = async (incomingSession: Session | null) => {
      if (!incomingSession) {
        if (!isMounted) return;
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      const status = typeof userError === "object" && userError !== null && "status" in userError
        ? Number((userError as { status?: unknown }).status)
        : null;

      if ((status === 401 || status === 403) || (!userData.user && !userError)) {
        await clearLocalSession();
        return;
      }

      if (userError) {
        // Si hay un fallo temporal de red/servicio, mantenemos la sesión local.
        if (!isMounted) return;
        setSession(incomingSession);
        setUser(incomingSession.user ?? null);
        setLoading(false);
        return;
      }

      if (!isMounted) return;
      setSession(incomingSession);
      setUser(userData.user);
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

  const signUp = async (
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
  };

  const signIn = async (email: string, password: string) => {
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

      return { data, error: null };
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return { error: new Error(error.errors[0].message) };
      }
      toast.error("Error inesperado al iniciar sesión");
      return { error: error as Error };
    }
  };

  const signOut = async () => {
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
  };

  return {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
  };
};
