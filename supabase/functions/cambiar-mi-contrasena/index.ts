import { createClient as base } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { ejecutarOperacionAuthAuditada } from "../_shared/audit-auth.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { handleCambioContrasena, type Verificacion } from "./handler.ts";

// «Mi cuenta» › Cambiar contraseña. Ver handler.ts (orden y garantías) y la
// migración 20261103170000_cambio_contrasena_propia.sql (límite de intentos).
const FUENTE = "cambiar-mi-contrasena";
const createClient = clienteConAuditoria(base, FUENTE);

Deno.serve(
  conAuditoriaDePeticion(FUENTE, base, async (req) => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    return handleCambioContrasena(req, {
      identificar: async (token) => {
        const { data, error } = await admin.auth.getUser(token);
        if (error) {
          if (Number(error.status ?? 0) >= 500) throw new Error("auth unavailable");
          return null;
        }
        return data.user ? { id: data.user.id, email: data.user.email } : null;
      },
      iniciar: async (actorId) => {
        const { data, error } = await admin.rpc("iniciar_cambio_contrasena", { p_actor: actorId });
        if (error || !data?.id) throw new Error("audit unavailable");
        return data;
      },
      finalizar: async (id, actorId, resultado) => {
        const { error } = await admin.rpc("finalizar_cambio_contrasena", {
          p_id: id, p_actor: actorId, p_resultado: resultado,
        });
        if (error) throw new Error("audit unavailable");
      },
      verificar: async (email, contrasena): Promise<Verificacion> => {
        // Cliente aislado (como auditoria-revertir): la comprobación no
        // sustituye ni cierra la sesión del navegador, y su propia sesión se
        // revoca en cuanto termina.
        const aislado = base(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
        try {
          const { data, error } = await aislado.auth.signInWithPassword({ email, password: contrasena });
          if (error) {
            const status = Number(error.status ?? 0);
            if (status === 429) return { resultado: "limite" };
            if (!status || status >= 500) throw new Error("auth unavailable");
            return { resultado: "incorrecta" };
          }
          return data.user ? { resultado: "correcta", id: data.user.id } : { resultado: "incorrecta" };
        } finally {
          await aislado.auth.signOut({ scope: "local" }).catch(() => {});
        }
      },
      // Con el JWT del propio usuario (PUT /user) y no con la API de admin: Auth
      // cierra entonces las demás sesiones de la cuenta pero conserva esta
      // (UpdatePassword → LogoutAllExceptMe; la API de admin las cierra todas).
      // `current_password` solo cuenta si se activa en Auth «exigir la contraseña
      // actual»; hoy se ignora. El trigger de auth.users exige el contexto de
      // auditoría (autor = él): sin él, Auth no puede cambiar la contraseña.
      actualizar: (actorId, token, nueva, actual) =>
        ejecutarOperacionAuthAuditada(admin, actorId, "actualizar", { userId: actorId }, async () => {
          const respuesta = await fetch(`${url}/auth/v1/user`, {
            method: "PUT",
            headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ password: nueva, current_password: actual }),
          });
          if (respuesta.ok) return { error: null };
          const cuerpo = await respuesta.json().catch(() => null);
          const codigo = typeof cuerpo?.error_code === "string" ? cuerpo.error_code : typeof cuerpo?.code === "string" ? cuerpo.code : undefined;
          return { error: { status: respuesta.status, code: codigo } };
        }),
    });
  }),
);
