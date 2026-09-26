import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sin fallback hardcodeado: si SUPER_ADMIN_EMAILS no está definida NO hay
// ningún super admin y la autorización recae por completo en is_super_admin()
// (tabla super_admins). Nunca conceder acceso por defecto — fail-closed.
const SUPER_ADMIN_EMAILS = (Deno.env.get("SUPER_ADMIN_EMAILS") ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const isSuperAdminEmail = (email?: string | null) =>
  !!email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase());

interface SetSuperAdminRequest {
  userId: string;
  makeSuperAdmin: boolean;
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

    // Conceder o revocar el acceso de super admin es una escalada mayor que
    // gestionar roles/permisos normales, así que el listón es más alto que en
    // el resto de funciones admin-*: ser "admin" no basta, hay que ser super
    // admin ya (tabla super_admins), no solo tener el rol "admin".
    const currentUserIsSuperAdmin = isSuperAdminEmail(currentUser.email);

    const { data: isSuperAdminResult, error: superAdminCheckError } = await supabaseAdmin.rpc(
      "is_super_admin",
      { _user_id: currentUser.id }
    );

    if (superAdminCheckError && !currentUserIsSuperAdmin) {
      console.error("Error checking super admin status:", superAdminCheckError);
      return new Response(JSON.stringify({ error: "Error verificando permisos" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!isSuperAdminResult && !currentUserIsSuperAdmin) {
      return new Response(
        JSON.stringify({ error: "Solo un super admin puede gestionar otros super admins" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: SetSuperAdminRequest = await req.json();
    const { userId, makeSuperAdmin } = body;

    if (!userId || typeof makeSuperAdmin !== "boolean") {
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

    if (makeSuperAdmin) {
      const { data: targetUserData, error: targetUserError } =
        await supabaseAdmin.auth.admin.getUserById(userId);

      if (targetUserError || !targetUserData?.user) {
        return new Response(JSON.stringify({ error: "No se pudo validar el usuario objetivo" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: insertError } = await supabaseAdmin
        .from("super_admins")
        .upsert(
          { user_id: userId, email: targetUserData.user.email },
          { onConflict: "email" }
        );

      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Un super admin siempre debe tener también el rol "admin": si no, se
      // queda fuera del Admin Panel normal (has_section_permission depende de
      // is_admin(), no de is_super_admin()).
      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id" });

      if (roleError) {
        return new Response(JSON.stringify({ error: roleError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const { error: deleteError } = await supabaseAdmin
        .from("super_admins")
        .delete()
        .eq("user_id", userId);

      if (deleteError) {
        return new Response(JSON.stringify({ error: deleteError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
});
