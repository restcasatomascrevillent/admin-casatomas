import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import {
  clienteConAuditoria,
  conAuditoriaDePeticion,
} from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "list-users");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Sin fallback hardcodeado: si SUPER_ADMIN_EMAILS no está definida NO hay
// ningún super admin y la autorización recae por completo en is_admin()
// (rol en user_roles). Nunca conceder acceso por defecto — fail-closed.
const SUPER_ADMIN_EMAILS = (Deno.env.get("SUPER_ADMIN_EMAILS") ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const isSuperAdminEmail = (email?: string | null) =>
  !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());

Deno.serve(
  conAuditoriaDePeticion("list-users", createClientBase, async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Get authorization header
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create clients
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

      // Client with user's token to verify they're admin
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      // Client with service role for admin operations
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Get current user
      const {
        data: { user: currentUser },
        error: userError,
      } = await supabaseUser.auth.getUser();
      if (userError || !currentUser) {
        return new Response(
          JSON.stringify({ error: "Usuario no autenticado" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const currentUserIsSuperAdmin = isSuperAdminEmail(currentUser.email);

      // Check if current user is admin
      const { data: isAdminResult, error: adminCheckError } =
        await supabaseAdmin.rpc("is_admin", { _user_id: currentUser.id });

      if (adminCheckError || (!isAdminResult && !currentUserIsSuperAdmin)) {
        return new Response(
          JSON.stringify({ error: "Solo administradores pueden ver usuarios" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      // Auth entrega solo una página si se omiten page/perPage.
      const users: Array<{ id: string; email?: string; display_name: string | null; created_at: string; access_blocked: boolean }> = [];
      const perPage = 1000;
      for (let page = 1; ; page++) {
        const { data: authUsers, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (usersError || !authUsers?.users) throw usersError ?? new Error("Auth no devolvió la lista de usuarios");
        users.push(...authUsers.users.map((user) => ({
          id: user.id,
          email: user.email,
          display_name: typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null,
          created_at: user.created_at,
          access_blocked: !!user.banned_until && new Date(user.banned_until).getTime() > Date.now(),
        })));
        if (authUsers.users.length < perPage) break;
      }

      return new Response(JSON.stringify({ users }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Unexpected error:", error);
      return new Response(
        JSON.stringify({ error: "Error interno del servidor" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  }),
);
