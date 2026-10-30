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

// Quién puede ver la lista: rol admin (is_admin) o fila en super_admins
// (is_super_admin), siempre según la BD. El email del JWT ya no basta aunque
// esté en SUPER_ADMIN_EMAILS (CT-REM-FN-12). is_admin solo mira user_roles, así
// que un super admin sin rol admin entra por is_super_admin (antes entraba por
// su email). Si alguna RPC falla se responde 503 (fail-closed).
type RespuestaRpc = { data: unknown; error: unknown };
const respuestaJson = (cuerpo: unknown, status: number) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

      let puedeVer = false;
      for (const rpc of ["is_admin", "is_super_admin"] as const) {
        const { data, error } = (await supabaseAdmin.rpc(rpc, {
          _user_id: currentUser.id,
        })) as RespuestaRpc;
        if (error) {
          console.error(`Error comprobando ${rpc}:`, error);
          return respuestaJson(
            { error: "No se pudieron verificar tus permisos. Vuelve a intentarlo." },
            503,
          );
        }
        if (data === true) {
          puedeVer = true;
          break;
        }
      }

      if (!puedeVer) {
        return respuestaJson(
          { error: "Solo administradores pueden ver usuarios" },
          403,
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
