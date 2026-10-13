import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { ejecutarOperacionAuthAuditada } from "../_shared/audit-auth.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { datosUsuarios, errorAuthUsuarios, esIdUsuario } from "../_shared/gestion-usuarios.ts";
const createClient = clienteConAuditoria(createClientBase, "admin-update-user-password");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Sin fallback hardcodeado: si SUPER_ADMIN_EMAILS no está definida NO hay
// ningún super admin por email: se comprueba la tabla super_admins.
// El rol admin solo permite consultar usuarios, nunca gestionarlos.
const SUPER_ADMIN_EMAILS = (Deno.env.get("SUPER_ADMIN_EMAILS") ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const isSuperAdminEmail = (email?: string | null) =>
  !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());

Deno.serve(conAuditoriaDePeticion("admin-update-user-password", createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user: currentUser },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !currentUser) {
      return new Response(JSON.stringify({ error: "Usuario no autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currentUserIsSuperAdmin = isSuperAdminEmail(currentUser.email);

    const { data: isSuperAdminResult, error: superAdminCheckError } = await supabaseAdmin.rpc("is_super_admin", {
      _user_id: currentUser.id,
    });

    if (superAdminCheckError || (!isSuperAdminResult && !currentUserIsSuperAdmin)) {
      return new Response(
        JSON.stringify({ error: "Solo un super admin puede actualizar contraseñas" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await datosUsuarios(req);
    const userId = body?.userId;
    const password = body?.password;

    if (!esIdUsuario(userId) || typeof password !== "string") {
      return new Response(JSON.stringify({ error: "userId y password son obligatorios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "La contraseña debe tener al menos 6 caracteres" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (userId === currentUser.id) {
      return new Response(JSON.stringify({ error: "No puedes cambiar tu propia contraseña aquí" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: objetivo, error: objetivoError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (objetivoError || !objetivo?.user) {
      const fallo = errorAuthUsuarios(objetivoError ?? { status: 404 }, "No se pudo consultar el usuario. Vuelve a intentarlo.");
      return new Response(JSON.stringify({ error: fallo.error }), { status: fallo.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: updateError } = await ejecutarOperacionAuthAuditada(
      supabaseAdmin, currentUser.id, "actualizar", { userId },
      () => supabaseAdmin.auth.admin.updateUserById(userId, { password }),
    );
    if (updateError) {
      const fallo = errorAuthUsuarios(updateError, "No se pudo actualizar la contraseña. Vuelve a intentarlo.");
      return new Response(JSON.stringify({ error: fallo.error }), {
        status: fallo.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error updating password:", error);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
