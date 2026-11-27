import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarPase } from "./pase.ts";

// Redes (rrss dentro del panel): pase firmado de un solo uso para abrir rrss en
// un iframe sin otra cuenta ni contraseña. Lógica en pase.ts.
// Secretos: RRSS_EMBED_PRIVATE_JWK, RRSS_EMBED_KID, RRSS_EMBED_ISSUER,
// RRSS_EMBED_BRAND_ID y RRSS_EMBED_PANEL_ORIGINS (y, si no es «rrss»,
// RRSS_EMBED_AUDIENCE). Ver docs/redes-rrss.md.
Deno.serve(conAuditoriaDePeticion("rrss-embed-pass", createClient, (req) => manejarPase(req, { crearCliente: createClient })));
