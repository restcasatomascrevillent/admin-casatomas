// transcribir-dictado — dictado por voz del panel (chat de Facturas) cuando el
// navegador no tiene reconocimiento de voz propio (Safari de iPhone/iPad,
// Firefox…). Recibe un audio corto (multipart, campo «audio»), lo transcribe
// con OpenAI (gpt-4o-mini-transcribe, ~0,003 $/min) y devuelve { ok, texto }.
// Exige sesión del panel (verify_jwt + getUser). No guarda el audio. Registra
// el coste en ia_uso. Clave: proceso «otros» (_shared/clave-openai.ts).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { exigirUsuario } from "../_shared/autorizacion.ts";
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { AcumuladorUso, registrarUso } from "../_shared/registrar-uso-ia.ts";
import { CORS, manejarDictado, MODELO_DICTADO } from "./logica.ts";

serve((req) =>
  manejarDictado(req, {
    autenticar: async (r) => {
      const u = await exigirUsuario(r, { crearCliente: createClient, corsHeaders: CORS });
      return u.ok ? { ok: true, userId: u.userId } : { ok: false, status: u.status, error: "No autorizado" };
    },
    clave: () => claveOpenAI("otros"),
    modelo: (Deno.env.get("DICTADO_MODELO") ?? "").trim() || MODELO_DICTADO,
    fetch,
    registrar: async ({ modelo, usage, error, userId, duracionMs }) => {
      const uso = new AcumuladorUso("transcribir-dictado", modelo, "otro");
      uso.sumar(usage);
      if (error) uso.marcarError();
      await registrarUso([uso], { disparador: `usuario:${userId}`, duracionMs });
    },
  })
);
