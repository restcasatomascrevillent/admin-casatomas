import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarPublicar } from "./publicar.ts";

// Marketing › Instagram. Toda la lógica (y su explicación) está en publicar.ts;
// aquí solo se engancha al envoltorio de auditoría, como el resto de funciones.
// Secretos de Meta (IG_ACCESS_TOKEN, IG_USER_ID, META_APP_ID y, opcionales,
// META_API_VERSION y META_APP_SECRET): Supabase → Edge Functions → Secrets.
Deno.serve(conAuditoriaDePeticion("instagram-publicar", createClientBase, (req) => manejarPublicar(req)));
