import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarMenu } from "./menu.ts";

// Redes: manda a rrss las tapas guardadas para que monte y programe la historia con su
// plantilla. Lógica en menu.ts. Secretos: los de rrss-embed-pass (RRSS_EMBED_*) y
// RRSS_EMBED_MENU_URL (…/functions/v1/embed-session/menu de rrss). Ver docs/redes-rrss.md.
Deno.serve(conAuditoriaDePeticion("rrss-menu", createClient, (req) => manejarMenu(req, { crearCliente: createClient })));
