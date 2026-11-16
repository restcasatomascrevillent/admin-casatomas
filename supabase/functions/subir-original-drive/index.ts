// subir-original-drive: sube el PDF de una factura del histórico a Drive y
// devuelve su enlace, sin tocar la BD. La lógica está en manejador.ts.
// Se despliega con --no-verify-jwt: la autenticación es x-subida-token.
import { crearManejador } from "./manejador.ts";

Deno.serve(crearManejador({
  token: Deno.env.get("SUBIDA_DRIVE_TOKEN"),
  drive: {
    clientId: (Deno.env.get("GOOGLE_CLIENT_ID") ?? "").trim(),
    clientSecret: (Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "").trim(),
    refreshToken: (Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "").trim(),
    parentFolder: (Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID") ?? "").trim(),
  },
}));
