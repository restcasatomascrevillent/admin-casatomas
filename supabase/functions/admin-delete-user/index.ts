import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

interface DeleteUserRequest {
  userId: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
        },
      },
    });

    const currentUserIsSuperAdmin = isSuperAdminEmail(currentUser.email);

    const { data: isAdminResult, error: adminCheckError } = await supabaseAdmin.rpc("is_admin", {
      _user_id: currentUser.id,
    });

    if (adminCheckError || (!isAdminResult && !currentUserIsSuperAdmin)) {
      return new Response(JSON.stringify({ error: "Solo administradores pueden eliminar usuarios" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: DeleteUserRequest = await req.json();
    const userId = body?.userId;

    if (!userId) {
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

    const { data: targetRoleData, error: targetRoleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    if (targetRoleError) {
      return new Response(JSON.stringify({ error: "No se pudo validar el usuario objetivo" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Un super admin nunca se puede eliminar directamente, ni siquiera otro
    // super admin: hay que quitarle antes el acceso de super admin (tabla
    // super_admins) con admin-set-super-admin.
    const { data: targetSuperAdminData } = await supabaseAdmin
      .from("super_admins")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (targetSuperAdminData) {
      return new Response(
        JSON.stringify({ error: "No se puede eliminar a un super admin: quítale antes el acceso de super admin" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (targetRoleData?.role === "admin") {
      // Un admin normal no puede eliminar a otro admin; un super admin sí
      // (tabla super_admins, la misma autorización que admin-set-super-admin).
      const { data: isSuperAdminResult } = await supabaseAdmin.rpc("is_super_admin", {
        _user_id: currentUser.id,
      });

      if (!isSuperAdminResult && !currentUserIsSuperAdmin) {
        return new Response(JSON.stringify({ error: "No se puede eliminar un usuario administrador" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500,
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
});
