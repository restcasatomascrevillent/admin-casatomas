import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { datosUsuarios, errorAuthUsuarios, esIdUsuario } from "../_shared/gestion-usuarios.ts";
const createClient = clienteConAuditoria(createClientBase, "admin-set-super-admin");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Quién puede actuar: SOLO is_super_admin() (tabla super_admins). El email del
// JWT ya no sustituye a la BD cuando la RPC falla ni cuando devuelve false
// (CT-REM-FN-12): si alguien consigue poner en su cuenta un email del
// allowlist, no se convierte en super admin. SUPER_ADMIN_EMAILS solo protege
// las cuentas objetivo (no se les retira el acceso). Fail-closed.
const SUPER_ADMIN_EMAILS = (Deno.env.get("SUPER_ADMIN_EMAILS") ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const isSuperAdminEmail = (email?: string | null) =>
  !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());

Deno.serve(conAuditoriaDePeticion("admin-set-super-admin", createClientBase, async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    // Lleva quién es el actor en cabeceras propias: la conexión de service
    // role no tiene JWT, así que auth.uid() es NULL en la base de datos —
    // fn_registrar_auditoria() (tabla audit_log) lee estas cabeceras como
    // respaldo para no perder de vista quién concedió/quitó el acceso.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          "x-audit-actor-id": currentUser.id,
          "x-audit-actor-email": currentUser.email ?? "",
          "x-audit-source": "admin-set-super-admin",
        },
      },
    });

    // Conceder o revocar el acceso de super admin es una escalada mayor que
    // gestionar roles/permisos normales, así que el listón es más alto que en
    // el resto de funciones admin-*: ser "admin" no basta, hay que ser super
    // admin ya (tabla super_admins), no solo tener el rol "admin".
    const { data: isSuperAdminResult, error: superAdminCheckError } = await supabaseAdmin.rpc(
      "is_super_admin",
      { _user_id: currentUser.id }
    );

    if (superAdminCheckError) {
      console.error("Error checking super admin status:", superAdminCheckError);
      return new Response(JSON.stringify({ error: "Error verificando permisos" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isSuperAdminResult !== true) {
      return new Response(
        JSON.stringify({ error: "Solo un super admin puede gestionar otros super admins" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await datosUsuarios(req);
    const userId = body?.userId;
    const makeSuperAdmin = body?.makeSuperAdmin;

    if (!esIdUsuario(userId) || typeof makeSuperAdmin !== "boolean") {
      return new Response(
        JSON.stringify({ error: "userId y makeSuperAdmin son obligatorios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (userId === currentUser.id && !makeSuperAdmin) {
      return new Response(
        JSON.stringify({ error: "No puedes quitarte a ti mismo el acceso de super admin" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: targetUserData, error: targetUserError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (targetUserError || !targetUserData?.user?.email) {
      const fallo = errorAuthUsuarios(targetUserError ?? { status: 404 }, "No se pudo consultar el usuario. Vuelve a intentarlo.");
      return new Response(JSON.stringify({ error: fallo.error }), { status: fallo.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!makeSuperAdmin && isSuperAdminEmail(targetUserData.user.email)) {
      return new Response(JSON.stringify({ error: "Esta cuenta tiene acceso de super admin fijado en la configuración del sistema" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (makeSuperAdmin && targetUserData.user.banned_until && new Date(targetUserData.user.banned_until).getTime() > Date.now()) {
      return new Response(JSON.stringify({ error: "Desbloquea el acceso del usuario antes de hacerlo super admin" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: cambioError } = await supabaseAdmin.rpc("establecer_superadmin_panel", {
      p_user_id: userId,
      p_make_super_admin: makeSuperAdmin,
      p_email: targetUserData.user.email,
    });
    if (cambioError) {
      console.error("Error cambiando el acceso de super admin:", cambioError);
      return new Response(JSON.stringify({ error: cambioError.code === "P0002"
        ? "El usuario ya no existe. Actualiza la lista."
        : cambioError.code === "22023"
          ? "Desbloquea el acceso del usuario antes de hacerlo super admin"
          : "No se pudo cambiar el acceso de super admin. No se ha aplicado ningún cambio; vuelve a intentarlo." }), {
        status: cambioError.code === "P0002" ? 404 : cambioError.code === "22023" ? 400 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error setting super admin status:", error);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));

