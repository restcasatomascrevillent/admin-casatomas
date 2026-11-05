import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarIA } from "./ia.ts";

// Marketing › Instagram › IA de textos. Toda la lógica (y su explicación)
// está en ia.ts; aquí solo se engancha al envoltorio de auditoría, como el
// resto de funciones. Secreto: OPENAI_API_KEY (el general de las funciones de
// IA). Opcionales: INSTAGRAM_IA_MODEL e INSTAGRAM_IA_CUPO_DIARIO. Ver
// docs/instagram-ia.md.
Deno.serve(conAuditoriaDePeticion("instagram-ia", createClientBase, (req) => manejarIA(req)));
