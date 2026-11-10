import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarNewsletterIA } from "./ia.ts";

// Newsletter › «Crear con IA»: la IA redacta el correo y propone su
// presentación por bloques. Nunca envía ni guarda nada (ver ia.ts).
// Secreto: OPENAI_API_KEY (el general). Opcional: NEWSLETTER_IA_MODEL.
// Necesita la migración 20261122153700_newsletter_plantillas.

const url = Deno.env.get("SUPABASE_URL");
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// Solo para leer el modelo elegido en Super Admin › Servicios › Modelos
// (ia_modelo_funcion). El resto va con el JWT del usuario (RLS).
const clienteModelos = url && service
  ? createClientBase(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

Deno.serve(conAuditoriaDePeticion("newsletter-ia", createClientBase, (req) => manejarNewsletterIA(req, { clienteModelos })));
