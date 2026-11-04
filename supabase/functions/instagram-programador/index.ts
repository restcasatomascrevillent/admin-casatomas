import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarProgramador } from "./programador.ts";

// Marketing › Instagram › publicaciones programadas. La llama SOLO pg_cron
// (cada 5 min, sin usuario): autenticación propia con la cabecera
// x-webhook-secret == INSTAGRAM_PROGRAMADOR_SECRET (compararTiempoConstante,
// falla cerrado). Toda la lógica y su explicación, en programador.ts.
// Secretos: los de Meta de instagram-publicar + INSTAGRAM_PROGRAMADOR_SECRET.
Deno.serve(conAuditoriaDePeticion("instagram-programador", createClientBase, (req) => manejarProgramador(req)));
