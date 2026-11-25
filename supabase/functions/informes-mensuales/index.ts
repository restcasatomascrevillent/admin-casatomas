// informes-mensuales: sube a Google Drive los PDF de la tarea programada del
// último jueves (informes de Super Admin › Informes y recibo mensual de Gestor
// Gasto). La lógica y su explicación están en manejador.ts.
// Secretos: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
// GOOGLE_DRIVE_PARENT_FOLDER_ID (los de las facturas) y, opcional,
// INFORMES_DRIVE_CARPETA_ID para guardarlos en otra carpeta.
import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { exigirSuperAdmin } from "../_shared/autorizacion.ts";
import { ClienteDrive } from "../_shared/google-drive.ts";
import { CORS, crearManejador } from "./manejador.ts";

const createClient = clienteConAuditoria(createClientBase, "informes-mensuales");
const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";

const manejador = crearManejador({
  autorizar: (req) => exigirSuperAdmin(req, { crearCliente: createClient, corsHeaders: CORS }),
  drive: new ClienteDrive({
    config: {
      clientId: Deno.env.get("GOOGLE_CLIENT_ID"),
      clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      refreshToken: Deno.env.get("GOOGLE_REFRESH_TOKEN"),
    },
  }),
  carpetaInformes: Deno.env.get("INFORMES_DRIVE_CARPETA_ID"),
  carpetaPadre: Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID"),
  // Producción (casatomas-prod): en la demo la carpeta se llama «Informes mensuales (demo)».
  produccion: URL_SB.includes("haqmmdfdzzatdnrrcgez"),
});

Deno.serve(conAuditoriaDePeticion("informes-mensuales", createClientBase, manejador));
