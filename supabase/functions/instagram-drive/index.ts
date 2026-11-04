import { createClient as createClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { conAuditoriaDePeticion } from "../_shared/audit-client.ts";
import { manejarDrive } from "./drive.ts";

// Marketing › Instagram: biblioteca de fotos en Google Drive. Toda la lógica
// (y su explicación) está en drive.ts; aquí solo se engancha al envoltorio de
// auditoría, como el resto de funciones. Secretos de Google (GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN y GOOGLE_DRIVE_MARKETING_FOLDER_ID):
// Supabase → Edge Functions → Secrets.
Deno.serve(conAuditoriaDePeticion("instagram-drive", createClientBase, (req) => manejarDrive(req)));
