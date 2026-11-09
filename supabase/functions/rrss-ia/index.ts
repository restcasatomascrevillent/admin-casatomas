import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarRrssIA } from "./ia.ts";

// RRSS › editor IA: la IA que PROPONE (plan de edición, textos, ideas para
// grabar y transcripción). La edición real la hace el motor de Vercel
// (api/rrss-foto, api/rrss-video). Instrucciones permanentes en prompts.ts.
// Secreto: OPENAI_API_KEY (el general). Opcionales: RRSS_IA_MODEL y
// RRSS_TRANSCRIPCION_MODEL. Ver docs/rrss.md.
Deno.serve(conAuditoriaDePeticion("rrss-ia", createClientBase, (req) => manejarRrssIA(req)));
