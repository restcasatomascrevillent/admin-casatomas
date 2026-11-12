import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarOriginal } from "./original.ts";

// Facturas › ficha de un documento: el ORIGINAL de Google Drive servido con la
// cuenta del restaurante (sin depender de la sesión de Google del navegador).
// Toda la lógica y su explicación están en original.ts.
const createClient = clienteConAuditoria(createClientBase, "facturas-original");

Deno.serve(conAuditoriaDePeticion("facturas-original", createClientBase, (req) => manejarOriginal(req, { crearCliente: createClient })));
