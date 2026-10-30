import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { ejecutarOperacionAuthAuditada } from "../_shared/audit-auth.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { datosUsuarios, errorAuthUsuarios, esIdUsuario } from "../_shared/gestion-usuarios.ts";
const createClient = clienteConAuditoria(createClientBase, "admin-delete-user");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Quién puede eliminar: SOLO la tabla super_admins (RPC is_super_admin). El
// email del JWT ya no basta aunque esté en SUPER_ADMIN_EMAILS (CT-REM-FN-12);
// si la RPC falla se responde 503 sin borrar nada (fail-closed).
// SUPER_ADMIN_EMAILS solo sirve aquí para PROTEGER cuentas objetivo.
// El rol admin solo permite consultar usuarios, nunca gestionarlos.
const SUPER_ADMIN_EMAILS = (Deno.env.get("SUPER_ADMIN_EMAILS") ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const isSuperAdminEmail = (email?: string | null) =>
  !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());

Deno.serve(conAuditoriaDePeticion("admin-delete-user", createClientBase, async (req) => {
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
    // respaldo para no perder de vista quién borró el usuario.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          "x-audit-actor-id": currentUser.id,
          "x-audit-actor-email": currentUser.email ?? "",
          "x-audit-source": "admin-delete-user",
        },
      },
    });

    const { data: isSuperAdminResult, error: superAdminCheckError } = await supabaseAdmin.rpc("is_super_admin", {
      _user_id: currentUser.id,
    });

    if (superAdminCheckError) {
      console.error("Error checking super admin status:", superAdminCheckError);
      return new Response(JSON.stringify({ error: "No se pudieron verificar tus permisos. No se ha eliminado nada; vuelve a intentarlo." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isSuperAdminResult !== true) {
      return new Response(JSON.stringify({ error: "Solo un super admin puede eliminar usuarios" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await datosUsuarios(req);
    const userId = body?.userId;

    if (!esIdUsuario(userId)) {
      return new Response(JSON.stringify({ error: "userId es obligatorio" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userId === currentUser.id) {
      return new Response(JSON.stringify({ error: "No puedes eliminar tu propio usuario" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: objetivo, error: objetivoError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (objetivoError || !objetivo?.user) {
      const fallo = errorAuthUsuarios(objetivoError ?? { status: 404 }, "No se pudo consultar el usuario. Vuelve a intentarlo.");
      return new Response(JSON.stringify({ error: fallo.error }), { status: fallo.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Un super admin nunca se puede eliminar directamente, ni siquiera otro
    // super admin: hay que quitarle antes el acceso de super admin (tabla
    // super_admins) con admin-set-super-admin.
    const { data: targetSuperAdminData, error: targetSuperAdminError } = await supabaseAdmin
      .from("super_admins")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (targetSuperAdminError) {
      return new Response(JSON.stringify({ error: "No se pudo validar el usuario objetivo" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (targetSuperAdminData || isSuperAdminEmail(objetivo.user.email)) {
      return new Response(
        JSON.stringify({ error: "No se puede eliminar a un super admin: quítale antes el acceso de super admin" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: deleteError } = await ejecutarOperacionAuthAuditada(
      supabaseAdmin, currentUser.id, "eliminar", { userId },
      () => supabaseAdmin.auth.admin.deleteUser(userId),
    );

    if (deleteError) {
      const fallo = errorAuthUsuarios(deleteError, "No se pudo eliminar el usuario. Vuelve a intentarlo.");
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
    console.error("Unexpected error deleting user:", error);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));

