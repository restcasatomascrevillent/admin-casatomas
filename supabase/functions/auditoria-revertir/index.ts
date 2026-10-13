import { createClient as base } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  clienteConAuditoria,
  conAuditoriaDePeticion,
} from "../_shared/audit-client.ts";
import { handleReversion } from "./handler.ts";

const createClient = clienteConAuditoria(base, "auditoria-revertir");
Deno.serve(
  conAuditoriaDePeticion("auditoria-revertir", base, async (req) => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const client = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    return handleReversion(req, {
      identify: async (token) => {
        const { data, error } = await client.auth.getUser(token);
        return error ? null : data.user;
      },
      isSuperAdmin: async (id) => {
        const { data, error } = await client
          .from("super_admins")
          .select("user_id")
          .eq("user_id", id)
          .maybeSingle();
        if (error) throw new Error("No se pudo comprobar el permiso");
        return Boolean(data);
      },
      beginValidation: async (actor, event) => {
        const { data, error } = await client.rpc(
          "iniciar_validacion_reversion",
          { p_actor: actor, p_evento: event },
        );
        if (error) throw error;
        return data === true;
      },
      verifyPassword: async (email, password) => {
        // Cliente aislado: la validación no sustituye ni cierra la sesión del navegador.
        const authClient = base(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        try {
          const { data, error } = await authClient.auth.signInWithPassword({
            email,
            password,
          });
          return error ? null : data.user;
        } finally {
          await authClient.auth.signOut({ scope: "local" }).catch(() => {});
        }
      },
      revert: async (event, actor, confirm) => {
        const { data, error } = await client.rpc("revertir_cambio_auditoria", {
          p_evento: event,
          p_actor: actor,
          p_confirmar: confirm,
        });
        if (error) throw error;
        return data;
      },
    });
  }),
);
