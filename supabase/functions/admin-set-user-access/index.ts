import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import {
  clienteConAuditoria,
  conAuditoriaDePeticion,
} from "../_shared/audit-client.ts";
import { ejecutarOperacionAuthAuditada } from "../_shared/audit-auth.ts";
import { handleUserAccess } from "./handler.ts";

const createClient = clienteConAuditoria(
  createClientBase,
  "admin-set-user-access",
);

Deno.serve(
  conAuditoriaDePeticion("admin-set-user-access", createClientBase, (req) => {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return handleUserAccess(req, {
      currentUser: async () => {
        const { data, error } = await userClient.auth.getUser();
        return error ? null : data.user;
      },
      isSuperAdmin: async (userId) => {
        const { data, error } = await admin.rpc("is_super_admin", {
          _user_id: userId,
        });
        if (error) throw error;
        return data === true;
      },
      targetUser: async (userId) => {
        const { data, error } = await admin.auth.admin.getUserById(userId);
        if (error) {
          if (error.status === 404) return null;
          throw error;
        }
        if (!data.user) return null;
        const { data: role, error: roleError } = await admin
          .from("super_admins")
          .select("user_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (roleError) throw roleError;
        const emails = (Deno.env.get("SUPER_ADMIN_EMAILS") ?? "")
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean);
        return {
          id: userId,
          isSuperAdmin:
            !!role || emails.includes(data.user.email?.toLowerCase() ?? ""),
        };
      },
      setBlocked: async (actorId, userId, blocked) => {
        // Auth modifica solo banned_until. El trigger revoca sesiones, notifica
        // a los dispositivos y la auditoría guarda autor y valores anteriores.
        const { error } = await ejecutarOperacionAuthAuditada(
          admin,
          actorId,
          "actualizar",
          { userId },
          () =>
            admin.auth.admin.updateUserById(userId, {
              ban_duration: blocked ? "876000h" : "none",
            }),
        );
        if (error) throw error;
      },
    });
  }),
);
