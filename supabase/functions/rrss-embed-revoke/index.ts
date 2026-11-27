import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarAviso } from "./aviso.ts";

// Redes: aviso inmediato a rrss cuando a alguien le quitan «Redes». La llama la
// base de datos (disparador de user_permissions) con un secreto compartido. Lógica
// en aviso.ts. Secretos: los RRSS_EMBED_* de rrss-embed-pass, RRSS_EMBED_REVOKE_SECRET
// y RRSS_EMBED_REVOKE_URL. Ver docs/redes-rrss.md.
Deno.serve(conAuditoriaDePeticion("rrss-embed-revoke", createClient, (req) => manejarAviso(req, { crearCliente: createClient })));
