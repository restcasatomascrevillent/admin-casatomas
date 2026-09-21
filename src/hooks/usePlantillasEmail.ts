// ============================================================================
// usePlantillasEmail — acceso a `plantillas_email_reserva`
// ============================================================================
// Contrato de la tabla: supabase/migrations/20260920010000_sistema_emails_
// reserva.sql (NO aplicada todavía — ver informe final del editor). Esquema
// y reglas de negocio: supabase/functions/emails-reserva/plantillas.ts
// (cabecera).
//
// La tabla todavía no existe en la BD real (migración pendiente de aplicar),
// así que — igual que useConfiguracionReservas.ts con `configuracion_reservas`
// antes de que sus tipos estuvieran generados — se usa `.from(TABLA as any)`
// y se castea el resultado a mano. En cuanto se aplique la migración y se
// regeneren los tipos (`generate_typescript_types`), estos `as any` se pueden
// quitar sin tocar el resto del fichero.
//
// Versionado (append-only, ver migración): guardar SIEMPRE crea una fila
// nueva, nunca reescribe una versión ya guardada. "Restaurar" reutiliza la
// función SQL `fn_restaurar_version_plantilla` ya existente — no se
// reimplementa esa lógica aquí.
// ============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "./useAuth";

export type TipoPlantilla =
  | "solicitud_recibida"
  | "propuesta"
  | "confirmada"
  | "rechazada"
  | "recordatorio";

export const TIPOS_PLANTILLA: readonly TipoPlantilla[] = [
  "solicitud_recibida",
  "propuesta",
  "confirmada",
  "rechazada",
  "recordatorio",
];

export interface PlantillaEmailVersion {
  id: string;
  tipo: TipoPlantilla;
  version: number;
  es_actual: boolean;
  asunto: string;
  saludo: string;
  cuerpo: string;
  texto_boton_principal: string | null;
  texto_boton_secundario: string | null;
  pie: string | null;
  color_acento: string;
  color_oscuro: string;
  logo_url: string | null;
  bloques: Record<string, unknown> | null;
  nota_version: string | null;
  creado_por: string | null;
  creado_at: string;
}

/** Los campos que el panel puede editar (todo lo demás — id/version/es_actual/creado_*  — lo decide el guardado, no el formulario). */
export type CamposEditablesPlantilla = Pick<
  PlantillaEmailVersion,
  | "asunto"
  | "saludo"
  | "cuerpo"
  | "texto_boton_principal"
  | "texto_boton_secundario"
  | "pie"
  | "color_acento"
  | "color_oscuro"
  | "logo_url"
  | "bloques"
>;

const TABLA = "plantillas_email_reserva";

function claveConsulta(tipo: TipoPlantilla) {
  return ["plantillas-email", tipo] as const;
}

// ----------------------------------------------------------------------------
// La migración que crea esta tabla (20260920010000_sistema_emails_reserva.sql)
// TODAVÍA NO ESTÁ APLICADA — ver la nota al principio de este fichero. Hasta
// que se aplique, PostgREST responde "Could not find the table ... in the
// schema cache" (PGRST205) al leer/escribir, o "Could not find the function
// ..." (PGRST202) al restaurar una versión; en Postgres puro serían 42P01 /
// 42883. Mismo patrón que esErrorColumnaEscaleraFaltante en
// useConfiguracionTurnos.ts: se traduce a un mensaje que se entiende sin leer
// un log, en vez de dejar pasar el error crudo y romper la pantalla.
// ----------------------------------------------------------------------------
function esErrorTablaPlantillasFaltante(error: unknown): boolean {
  const mensaje = String((error as { message?: string } | null)?.message ?? "");
  const codigo = String((error as { code?: string } | null)?.code ?? "");
  return (
    codigo === "PGRST205" ||
    codigo === "PGRST202" ||
    codigo === "42P01" ||
    codigo === "42883" ||
    /plantillas_email_reserva|fn_restaurar_version_plantilla/.test(mensaje)
  );
}

const MENSAJE_MIGRACION_PENDIENTE =
  "Las plantillas de correo todavía no están disponibles: falta aplicar la migración pendiente en la base de datos (20260920010000_sistema_emails_reserva.sql). Pide que se aplique y vuelve a intentarlo.";

/** Todas las versiones de un tipo, más reciente primero. La "actual" es la que tiene es_actual=true. */
export function useVersionesPlantilla(tipo: TipoPlantilla) {
  return useQuery({
    queryKey: claveConsulta(tipo),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLA as any)
        .select("*")
        .eq("tipo", tipo)
        .order("version", { ascending: false });

      if (error) {
        if (esErrorTablaPlantillasFaltante(error)) throw new Error(MENSAJE_MIGRACION_PENDIENTE);
        throw error;
      }
      return (data ?? []) as unknown as PlantillaEmailVersion[];
    },
    staleTime: 30_000,
  });
}

interface GuardarPlantillaInput {
  campos: CamposEditablesPlantilla;
  notaVersion?: string;
  /** Número de la versión de la que se parte (la que estaba cargada al pulsar "Guardar"). */
  versionBase: number;
}

/**
 * Guarda un borrador como una NUEVA versión y la activa. Es una operación en
 * 3 pasos porque PostgREST no da transacciones multi-sentencia desde el
 * cliente; el orden está elegido para que ningún fallo intermedio deje el
 * tipo sin ninguna versión activa (ver comentarios en cada paso):
 *
 *   1. INSERT de la fila nueva con es_actual=false. Si falla (p.ej. choque de
 *      versión por guardado concurrente), no se ha tocado nada todavía.
 *   2. UPDATE de la versión anterior a es_actual=false.
 *   3. UPDATE de la fila nueva a es_actual=true.
 *
 * Si el paso 3 fallara tras el 2 (ventana muy breve), se intenta compensar
 * reactivando la versión anterior en vez de dejar el tipo sin plantilla
 * activa — un correo real de ese tipo debe poder enviarse siempre.
 */
export function useGuardarPlantilla(tipo: TipoPlantilla) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ campos, notaVersion, versionBase }: GuardarPlantillaInput) => {
      const nuevaVersionNumero = versionBase + 1;

      const { data: nueva, error: errInsert } = await supabase
        .from(TABLA as any)
        .insert({
          tipo,
          version: nuevaVersionNumero,
          es_actual: false,
          ...campos,
          nota_version: notaVersion?.trim() || null,
          creado_por: user?.id ?? null,
        })
        .select("*")
        .single();

      if (errInsert || !nueva) {
        if (esErrorTablaPlantillasFaltante(errInsert)) {
          throw new Error(MENSAJE_MIGRACION_PENDIENTE);
        }
        if ((errInsert as { code?: string } | null)?.code === "23505") {
          throw new Error(
            "Otra persona guardó una versión distinta mientras editabas. Recarga la pantalla para partir de la última versión — no se ha perdido el historial.",
          );
        }
        throw errInsert ?? new Error("No se pudo guardar la plantilla");
      }
      const nuevaFila = nueva as unknown as PlantillaEmailVersion;

      const { error: errDesactivar } = await supabase
        .from(TABLA as any)
        .update({ es_actual: false })
        .eq("tipo", tipo)
        .eq("es_actual", true);

      if (errDesactivar) {
        // La nueva versión ya quedó guardada en el historial (no se perdió el
        // texto); solo falta activarla. Reintentar "Guardar" resuelve esto.
        throw new Error(
          "La versión se guardó en el historial pero no se pudo activar todavía. Pulsa «Guardar» otra vez — no se ha perdido tu texto.",
        );
      }

      const { data: activada, error: errActivar } = await supabase
        .from(TABLA as any)
        .update({ es_actual: true })
        .eq("id", nuevaFila.id)
        .select("*")
        .single();

      if (errActivar || !activada) {
        // Compensación: restaurar la anterior para no dejar el tipo sin
        // plantilla activa (un correo real de este tipo debe poder salir).
        await supabase.from(TABLA as any).update({ es_actual: true }).eq("tipo", tipo).eq("version", versionBase);
        throw new Error("No se pudo activar la nueva versión; se ha restaurado la anterior. Vuelve a intentarlo.");
      }

      return activada as unknown as PlantillaEmailVersion;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: claveConsulta(tipo) });
      toast.success("Plantilla guardada. Los próximos correos usarán esta versión.");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al guardar la plantilla");
    },
  });
}

/** "Volver atrás": usa fn_restaurar_version_plantilla (copia hacia adelante, nunca reescribe el historial). */
export function useRestaurarVersionPlantilla(tipo: TipoPlantilla) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (versionARestaurar: number) => {
      const { data, error } = await supabase.rpc("fn_restaurar_version_plantilla" as any, {
        p_tipo: tipo,
        p_version_a_restaurar: versionARestaurar,
      });
      if (error) {
        if (esErrorTablaPlantillasFaltante(error)) throw new Error(MENSAJE_MIGRACION_PENDIENTE);
        throw error;
      }
      return data as unknown as PlantillaEmailVersion;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: claveConsulta(tipo) });
      toast.success(`Restaurada como nueva versión (v${data?.version ?? "?"}). Ya es la vigente.`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al restaurar la versión");
    },
  });
}

// ============================================================================
// ENVIAR PRUEBA — el endpoint TODAVÍA NO EXISTE en el backend.
// ----------------------------------------------------------------------------
// Este hook ya llama al contrato exacto que necesita el backend, para que
// activarlo sea solo trabajo de backend (cero cambios en el panel). Contrato
// propuesto, mismo estilo que el resto de emails-reserva/index.ts:
//
//   POST /functions/v1/emails-reserva/enviar-prueba
//   Auth: header Authorization con la sesión del usuario del panel (la pone
//         sola supabase.functions.invoke). El backend debe validar ese JWT y
//         exigir can_write_section('reservas') para ese usuario — igual
//         chequeo que ya hace fn_restaurar_version_plantilla. Esta ruta NO
//         debe ir protegida por x-webhook-secret: no es un cron ni un
//         servicio interno, la llama el navegador con sesión de usuario.
//   Body: {
//     tipo: TipoPlantilla,
//     destinatario: string,           // email al que se manda la prueba
//     plantilla: {                    // el BORRADOR actual del formulario
//       asunto, saludo, cuerpo,       // (NO la versión guardada), para poder
//       texto_boton_principal,        // probar antes de guardar
//       texto_boton_secundario, pie,
//       color_acento, color_oscuro, logo_url, bloques
//     }
//   }
//   El backend renderiza con datos de ejemplo (mismo criterio que
//   datosEjemploPara en catalogoTokens.ts de este panel: nombre/fecha/hora
//   ficticios, y para 'propuesta' con una hora/espacio distintos a lo
//   solicitado para poder ver también el bloque de contraoferta) y envía con
//   Resend usando renderPlantilla() de plantillas.ts — así la prueba usa
//   exactamente el mismo motor que un correo real.
//
//   Respuesta 200: { ok: true }
//   Respuestas ok:false que este hook ya sabe interpretar (ver más abajo):
//     { ok: false, error: "resend_sandbox_restriction", message?: string }
//        -- Resend está hoy en modo sandbox (remite desde onboarding@resend.dev)
//           y SOLO entrega al email verificado del dueño de la cuenta Resend;
//           a cualquier otro destinatario responde 403. El backend debe
//           detectar ese caso concreto (403 de Resend) y devolver este
//           código en vez de un error 500 genérico, para poder explicarlo
//           con claridad en el panel.
//     { ok: false, error: "no_autorizado" }
//     { ok: false, error: "plantilla_invalida", message?: string }
//     { ok: false, error: string, message?: string }   -- cualquier otro caso
// ============================================================================
export interface EnviarPruebaInput {
  destinatario: string;
  plantilla: CamposEditablesPlantilla;
}

interface RespuestaEnvioPrueba {
  ok: boolean;
  error?: string;
  message?: string;
}

export function useEnviarPruebaPlantilla(tipo: TipoPlantilla) {
  return useMutation({
    mutationFn: async ({ destinatario, plantilla }: EnviarPruebaInput) => {
      const { data, error } = await supabase.functions.invoke("emails-reserva/enviar-prueba", {
        body: { tipo, destinatario, plantilla },
      });

      if (error) {
        let cuerpo: RespuestaEnvioPrueba | null = null;
        const contextoRespuesta = (error as { context?: Response }).context;
        if (contextoRespuesta && typeof contextoRespuesta.json === "function") {
          try {
            cuerpo = await contextoRespuesta.clone().json();
          } catch {
            // La respuesta no era JSON (p.ej. un 404 en texto plano) — se ignora y cae al mensaje genérico de abajo.
          }
        }

        const status = contextoRespuesta?.status;
        if (status === 404 || cuerpo?.error === "not_found") {
          throw new Error(
            "El envío de prueba todavía no está disponible: falta implementar POST /emails-reserva/enviar-prueba en el backend (ver el comentario de contrato en usePlantillasEmail.ts).",
          );
        }
        if (cuerpo?.error === "resend_sandbox_restriction") {
          throw new Error(
            "Resend está en modo sandbox y hoy solo entrega correos a la dirección del dueño de la cuenta. El envío de prueba no ha salido por eso, no por un fallo del panel.",
          );
        }
        throw new Error(cuerpo?.message || error.message || "Error al enviar el correo de prueba");
      }

      const respuesta = data as RespuestaEnvioPrueba | null;
      if (respuesta && respuesta.ok === false) {
        if (respuesta.error === "resend_sandbox_restriction") {
          throw new Error(
            "Resend está en modo sandbox y hoy solo entrega correos a la dirección del dueño de la cuenta. El envío de prueba no ha salido por eso, no por un fallo del panel.",
          );
        }
        throw new Error(respuesta.message || respuesta.error || "Error al enviar el correo de prueba");
      }

      return respuesta;
    },
    onSuccess: (_data, variables) => {
      toast.success(`Correo de prueba enviado a ${variables.destinatario}`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
