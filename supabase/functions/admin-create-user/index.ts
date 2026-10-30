import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { ejecutarOperacionAuthAuditada } from "../_shared/audit-auth.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { datosUsuarios, errorAuthUsuarios } from "../_shared/gestion-usuarios.ts";
const createClient = clienteConAuditoria(createClientBase, "admin-create-user");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Quién puede crear usuarios: SOLO la tabla super_admins (RPC is_super_admin).
// El email del JWT no basta aunque esté en SUPER_ADMIN_EMAILS (CT-REM-FN-12):
// un staff podría cambiar su email a uno del allowlist. Si la RPC falla se
// responde 503 sin crear nada (fail-closed).
// El rol admin solo permite consultar usuarios, nunca gestionarlos.

// Contraseña mínima de las cuentas del panel (CT-REM-FN-03).
const LONGITUD_MINIMA_CONTRASENA = 10;

Deno.serve(conAuditoriaDePeticion("admin-create-user", createClientBase, async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header provided");
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Client with user's token to verify they're admin
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get current user
    const { data: { user: currentUser }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !currentUser) {
      console.error("Error getting current user:", userError);
      return new Response(
        JSON.stringify({ error: "Usuario no autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Client with service role for admin operations. Lleva quién es el actor
    // en cabeceras propias: la conexión de service role no tiene JWT, así
    // que auth.uid() es NULL en la base de datos — fn_registrar_auditoria()
    // (tabla audit_log) lee estas cabeceras como respaldo para no perder de
    // vista quién creó el usuario.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          "x-audit-actor-id": currentUser.id,
          "x-audit-actor-email": currentUser.email ?? "",
          "x-audit-source": "admin-create-user",
        },
      },
    });

    console.log("Request from user:", currentUser.id);

    // Toda la gestión de usuarios requiere ser superadmin.
    const { data: isSuperAdminResult, error: superAdminCheckError } = await supabaseAdmin
      .rpc("is_super_admin", { _user_id: currentUser.id });

    if (superAdminCheckError) {
      console.error("Error checking super admin status:", superAdminCheckError);
      return new Response(
        JSON.stringify({ error: "Error verificando permisos" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (isSuperAdminResult !== true) {
      console.error("User is not super admin:", currentUser.id);
      return new Response(
        JSON.stringify({ error: "Solo un super admin puede crear usuarios" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = await datosUsuarios(req);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = body?.password;
    const role = body?.role;
    const permissions = body?.permissions ?? [];

    // Validate input
    if (!username || typeof password !== "string" || !password) {
      return new Response(
        JSON.stringify({ error: "Nombre de usuario y contraseña son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate username format (letters, numbers, dots, underscores)
    const usernameRegex = /^[a-zA-Z0-9._]+$/;
    if (!usernameRegex.test(username) || username.length > 64 || username.startsWith(".") || username.endsWith(".") || username.includes("..")) {
      return new Response(
        JSON.stringify({ error: "El nombre de usuario solo puede contener letras, números, puntos y guiones bajos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < LONGITUD_MINIMA_CONTRASENA) {
      return new Response(
        JSON.stringify({ error: `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (role !== "admin" && role !== "manager" && role !== "staff") {
      return new Response(JSON.stringify({ error: "Configuración de acceso no válida" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const claves = new Set<string>();
    if (!Array.isArray(permissions) || permissions.length > 64 || permissions.some((p) => {
      if (!p || typeof p !== "object" || typeof p.section_key !== "string" || !/^[a-z_]{1,64}$/.test(p.section_key) || typeof p.can_view !== "boolean" || (p.can_edit != null && typeof p.can_edit !== "boolean") || claves.has(p.section_key)) return true;
      claves.add(p.section_key);
      return false;
    })) {
      return new Response(JSON.stringify({ error: "Los permisos enviados no son válidos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Generate internal email from username
    const internalEmail = `${username.toLowerCase()}@staff.local`;

    console.log("Creating user:", username, "with internal email:", internalEmail, "role:", role);

    // Create user with admin API
    const { data: newUserData, error: createError } = await ejecutarOperacionAuthAuditada(
      supabaseAdmin, currentUser.id, "crear", { email: internalEmail },
      () => supabaseAdmin.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: username,
        },
      }),
    );

    if (createError) {
      console.error("Error creating user:", createError);
      const fallo = errorAuthUsuarios(createError, "No se pudo crear el usuario. Vuelve a intentarlo.");
      return new Response(
        JSON.stringify({ error: fallo.error }),
        { status: fallo.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newUserId = newUserData?.user?.id;
    if (!newUserId) throw new Error("Auth no devolvió el usuario creado");
    console.log("User created with ID:", newUserId);

    const cancelarAlta = async () => {
      try {
        const { error: cancelarError } = await ejecutarOperacionAuthAuditada(
          supabaseAdmin, currentUser.id, "eliminar", { userId: newUserId },
          () => supabaseAdmin.auth.admin.deleteUser(newUserId),
        );
        if (cancelarError) throw cancelarError;
        return new Response(JSON.stringify({ error: "No se pudieron guardar los accesos. Se ha cancelado el alta; vuelve a intentarlo." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (cancelarError) {
        console.error("No se pudo cancelar el alta incompleta:", cancelarError);
        const { error: bloqueoError } = await ejecutarOperacionAuthAuditada(
          supabaseAdmin, currentUser.id, "actualizar", { userId: newUserId },
          () => supabaseAdmin.auth.admin.updateUserById(newUserId, { ban_duration: "876000h" }),
        );
        return new Response(JSON.stringify({ error: bloqueoError
          ? "No se pudo completar ni cancelar el alta. Revisa el usuario en la lista antes de repetirla."
          : "No se pudo completar el alta. El usuario ha quedado bloqueado; revisa sus accesos en la lista antes de desbloquearlo.", userId: newUserId }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    };

    try {

    // The trigger will create default staff role and dashboard permission
    // But we want to set the specific role requested
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: newUserId, role }, { onConflict: "user_id" });

    if (roleError) {
      console.error("Error setting role:", roleError);
      return await cancelarAlta();
    }

    // Delete any existing permissions and set new ones
    const { error: limpiarError } = await supabaseAdmin
      .from("user_permissions")
      .delete()
      .eq("user_id", newUserId);
    if (limpiarError) {
      console.error("Error preparing permissions:", limpiarError);
      return await cancelarAlta();
    }

    if (permissions && permissions.length > 0) {
      const permissionsToInsert = permissions.map((p) => ({
        user_id: newUserId,
        section_key: p.section_key,
        can_view: p.can_view || Boolean(p.can_edit),
        can_edit: Boolean(p.can_edit),
      }));

      const { error: permError } = await supabaseAdmin
        .from("user_permissions")
        .insert(permissionsToInsert);

      if (permError) {
        console.error("Error setting permissions:", permError);
        return await cancelarAlta();
      }
    }
    } catch (setupError) {
      console.error("Error configurando el usuario nuevo:", setupError);
      return await cancelarAlta();
    }

    console.log("User setup complete:", newUserId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        userId: newUserId, 
        username: username,
        email: newUserData.user.email 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));

