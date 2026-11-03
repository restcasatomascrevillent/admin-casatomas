import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { crearManejador } from "./servicios.ts";

// Super Admin › Servicios: consumo (y gasto por uso) de Vercel, Supabase, GitHub,
// Resend, Stripe, OpenAI, Vapi y Hostinger
// frente al límite de su plan. Toda la lógica (y su explicación) está en
// servicios.ts; aquí solo se engancha al envoltorio de auditoría.
const createClient = clienteConAuditoria(createClientBase, "servicios-uso");

Deno.serve(conAuditoriaDePeticion("servicios-uso", createClientBase, crearManejador({ crearCliente: createClient })));
