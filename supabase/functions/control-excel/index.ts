import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { clienteConAuditoria, conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { crearManejador } from "./control.ts";

// Super Admin › Gestor Gasto › «Control (Excel)»: lee y edita, en el Excel de
// control de OficiosOsIA que está en Google Drive, SOLO lo del cliente de este
// panel (su ficha, sus cobros y sus gastos). Toda la lógica (y su explicación)
// está en control.ts; aquí solo se engancha al envoltorio de auditoría.
const createClient = clienteConAuditoria(createClientBase, "control-excel");

Deno.serve(conAuditoriaDePeticion("control-excel", createClientBase, crearManejador({ crearCliente: createClient })));
