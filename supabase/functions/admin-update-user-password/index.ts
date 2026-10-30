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

// Quién puede actuar: SOLO la tabla super_admins (RPC is_super_admin). El email
// del JWT ya no basta aunque esté en SUPER_ADMIN_EMAILS (CT-REM-FN-12).
// SUPER_ADMIN_EMAILS solo sirve aquí para PROTEGER cuentas objetivo.
// El rol admin solo permite consultar usuarios, nunca gestionarlos.
//
// Regla CT-REM-FN-05: la contraseña de un super admin (tabla super_admins o
// email en SUPER_ADMIN_EMAILS) NO se cambia desde esta función, la pida quien
// la pida: su titular usa su propio flujo de recuperación. Así un super admin
// secundario (o una sesión robada) no puede tomar la cuenta del dueño.
// Contraseña mínima de las cuentas del panel (CT-REM-FN-03).
const LONGITUD_MINIMA_CONTRASENA = 10;

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

    const { data: isSuperAdminResult, error: superAdminCheckError } = await supabaseAdmin.rpc("is_super_admin", {
      _user_id: currentUser.id,
    });

    if (superAdminCheckError || isSuperAdminResult !== true) {
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

    if (password.length < LONGITUD_MINIMA_CONTRASENA) {
      return new Response(
        JSON.stringify({ error: `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres` }),
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

    const { data: objetivoSuperAdmin, error: objetivoSuperAdminError } = await supabaseAdmin
      .from("super_admins")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (objetivoSuperAdminError) {
      console.error("Error comprobando si el objetivo es super admin:", objetivoSuperAdminError);
      return new Response(JSON.stringify({ error: "No se pudo comprobar la cuenta. No se ha cambiado la contraseña." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (objetivoSuperAdmin || isSuperAdminEmail(objetivo.user.email)) {
      return new Response(JSON.stringify({ error: "La contraseña de un super admin no se puede cambiar desde aquí: debe usar su propia recuperación de contraseña" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
