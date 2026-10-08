import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { ejecutarOperacionAuthAuditada } from "../_shared/audit-auth.ts";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
const createClient = clienteConAuditoria(createClientBase, "admin-create-user");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

interface CreateUserRequest {
  username: string;
  password: string;
  role: "admin" | "manager" | "staff";
  permissions: Array<{
    section_key: string;
    can_view: boolean;
    can_edit: boolean;
  }>;
}

Deno.serve(conAuditoriaDePeticion("admin-create-user", createClientBase, async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
    const currentUserIsSuperAdmin = isSuperAdminEmail(currentUser.email);

    // Toda la gestión de usuarios requiere ser superadmin.
    const { data: isSuperAdminResult, error: superAdminCheckError } = await supabaseAdmin
      .rpc("is_super_admin", { _user_id: currentUser.id });

    if (superAdminCheckError && !currentUserIsSuperAdmin) {
      console.error("Error checking super admin status:", superAdminCheckError);
      return new Response(
        JSON.stringify({ error: "Error verificando permisos" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isSuperAdminResult && !currentUserIsSuperAdmin) {
      console.error("User is not super admin:", currentUser.id);
      return new Response(
        JSON.stringify({ error: "Solo un super admin puede crear usuarios" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: CreateUserRequest = await req.json();
    const { username, password, role, permissions } = body;

    // Validate input
    if (!username || !password) {
      return new Response(
        JSON.stringify({ error: "Nombre de usuario y contraseña son requeridos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate username format (letters, numbers, dots, underscores)
    const usernameRegex = /^[a-zA-Z0-9._]+$/;
    if (!usernameRegex.test(username)) {
      return new Response(
        JSON.stringify({ error: "El nombre de usuario solo puede contener letras, números, puntos y guiones bajos" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "La contraseña debe tener al menos 6 caracteres" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      if (createError.message.includes("already been registered")) {
        return new Response(
          JSON.stringify({ error: "Este email ya está registrado" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: createError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const newUserId = newUserData.user.id;
    console.log("User created with ID:", newUserId);

    // The trigger will create default staff role and dashboard permission
    // But we want to set the specific role requested
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: newUserId, role }, { onConflict: "user_id" });

    if (roleError) {
      console.error("Error setting role:", roleError);
      // Don't fail completely, user was created
    }

    // Delete any existing permissions and set new ones
    await supabaseAdmin
      .from("user_permissions")
      .delete()
      .eq("user_id", newUserId);

    if (permissions && permissions.length > 0) {
      const permissionsToInsert = permissions.map((p) => ({
        user_id: newUserId,
        section_key: p.section_key,
        can_view: p.can_view,
        can_edit: p.can_edit,
      }));

      const { error: permError } = await supabaseAdmin
        .from("user_permissions")
        .insert(permissionsToInsert);

      if (permError) {
        console.error("Error setting permissions:", permError);
      }
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

