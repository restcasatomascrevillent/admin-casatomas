// ============================================================================
// ENVÍO DE PRUEBA — partes puras (datos de ejemplo, validación del borrador,
// clasificación del error de sandbox de Resend, decisión de rate limit).
// Sin I/O: index.ts trae el borrador del body, arma el FilaPlantilla y llama
// a resend.emails.send(); aquí solo las decisiones, para poder testearlas
// sin red ni Supabase — mismo criterio que ausencias.ts/recordatorios.ts.
// ----------------------------------------------------------------------------
// Contrato completo del endpoint: src/hooks/usePlantillasEmail.ts:251-294
// (fichero de otro agente, de solo lectura desde aquí). Ese contrato es lo
// que index.ts debe satisfacer; este módulo no lo reimplementa, solo aporta
// las decisiones puras que el handler necesita.
// ============================================================================

import type { TipoPlantilla, DatosReservaParaCorreo } from "./plantillas.ts";
import { fechaObjetivoRecordatorio } from "./recordatorios.ts";

// ----------------------------------------------------------------------------
// Datos de ejemplo para los tokens {{nombre}} / {{fecha}} / {{hora}} /
// {{comensales}} / {{espacio}}
// ----------------------------------------------------------------------------
// Deliberadamente NO "Cliente de Ejemplo" ni huecos vacíos: el punto de la
// prueba es ver cómo queda el correo con datos que se parecen a los de un
// cliente real (punto 2 del encargo). Para 'propuesta' la HORA vigente se
// aparta a propósito de la solicitada, para que hayContraoferta()
// (plantillas.ts) dé true y la prueba enseñe también el bloque "Pediste / Te
// ofrecemos" — el único tipo donde ese bloque puede aparecer; en el resto no
// se rellena horaSolicitada, así que hayContraoferta() es false (mismo
// criterio que un correo real de ese tipo).
//
// `espacio`/`espacioSolicitado` se siguen rellenando por realismo, pero
// desde el 2026-09-28 NO se pintan en el correo (punto 7 del contrato en
// plantillas.ts) ni cuentan para hayContraoferta(): la prueba enseña
// exactamente lo mismo que vería el cliente.
//
// `fechaObjetivoRecordatorio` (recordatorios.ts) es solo aritmética de
// fechas genérica ("hoyIso + N días" en UTC, sin líos de zona horaria); se
// reutiliza aquí tal cual en vez de reimplementar el mismo cálculo con otro
// nombre — el nombre viene de su uso original (T-2 de un recordatorio) pero
// la función no depende de eso para nada.
// ----------------------------------------------------------------------------
const NOMBRE_EJEMPLO = "Laura Martínez";
const HORA_EJEMPLO_VIGENTE = "21:00";
const COMENSALES_EJEMPLO = 4;
const ESPACIO_EJEMPLO_VIGENTE = "Terraza";

export function datosEjemploParaTipo(tipo: TipoPlantilla, hoyIso: string): DatosReservaParaCorreo {
  const fecha = fechaObjetivoRecordatorio(hoyIso, 9);

  const base: DatosReservaParaCorreo = {
    nombre: NOMBRE_EJEMPLO,
    fecha,
    hora: HORA_EJEMPLO_VIGENTE,
    comensales: COMENSALES_EJEMPLO,
    espacio: ESPACIO_EJEMPLO_VIGENTE,
  };

  if (tipo === "propuesta") {
    return {
      ...base,
      horaSolicitada: "20:00",
      espacioSolicitado: "Salón",
    };
  }

  return base;
}

// ----------------------------------------------------------------------------
// Validación del borrador que manda el panel (CamposEditablesPlantilla en
// usePlantillasEmail.ts).
// ----------------------------------------------------------------------------
// No se comparte el tipo con el frontend: son runtimes distintos (Deno aquí,
// Vite/React allí), así que la FORMA se valida a mano en el backend. Lo que
// hace falta aquí es solo no reventar con undefined/tipos inesperados antes
// de construir el FilaPlantilla — renderPlantilla (plantillas.ts) ya se
// encarga de escapar/sustituir el CONTENIDO una vez la forma es válida.
// ----------------------------------------------------------------------------
export interface CamposPlantillaPrueba {
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
}

function esTextoOpcional(valor: unknown): valor is string | null | undefined {
  return valor === null || valor === undefined || typeof valor === "string";
}

/**
 * `null` si el borrador no trae lo mínimo para que una prueba tenga sentido
 * (asunto/saludo/cuerpo no vacíos). El resto de campos son opcionales; los
 * defaults de color_acento/color_oscuro replican los que renderPlantilla ya
 * aplica cuando la fila de verdad no los trae (plantillas.ts:425-426), para
 * que la prueba no se vea distinta de un correo real por un detalle tonto.
 */
export function validarPlantillaBorrador(valor: unknown): CamposPlantillaPrueba | null {
  if (!valor || typeof valor !== "object") return null;
  const v = valor as Record<string, unknown>;

  if (typeof v.asunto !== "string" || !v.asunto.trim()) return null;
  if (typeof v.saludo !== "string" || !v.saludo.trim()) return null;
  if (typeof v.cuerpo !== "string" || !v.cuerpo.trim()) return null;
  if (!esTextoOpcional(v.texto_boton_principal)) return null;
  if (!esTextoOpcional(v.texto_boton_secundario)) return null;
  if (!esTextoOpcional(v.pie)) return null;
  if (!esTextoOpcional(v.logo_url)) return null;
  if (v.bloques !== null && v.bloques !== undefined && typeof v.bloques !== "object") return null;

  return {
    asunto: v.asunto,
    saludo: v.saludo,
    cuerpo: v.cuerpo,
    texto_boton_principal: (v.texto_boton_principal as string | null | undefined) ?? null,
    texto_boton_secundario: (v.texto_boton_secundario as string | null | undefined) ?? null,
    pie: (v.pie as string | null | undefined) ?? null,
    color_acento: typeof v.color_acento === "string" && v.color_acento ? v.color_acento : "#B8936A",
    color_oscuro: typeof v.color_oscuro === "string" && v.color_oscuro ? v.color_oscuro : "#1C1F22",
    logo_url: (v.logo_url as string | null | undefined) ?? null,
    bloques: (v.bloques as Record<string, unknown> | null | undefined) ?? null,
  };
}

// ----------------------------------------------------------------------------
// Clasificación del error de Resend (punto 7 del encargo — el que más
// importa para quien lo use)
// ----------------------------------------------------------------------------
// La cuenta de Resend en modo sandbox (remitente del dominio resend.dev, sin
// verificar uno propio) SOLO entrega al email del dueño de la cuenta; a
// cualquier otro destinatario responde con:
//   { name: "validation_error", statusCode: 403,
//     message: "You can only send testing emails to your own email address
//     (tu@email.com). To send emails to other recipients, please verify a
//     domain at resend.com/domains..." }
// Confirmado contra la documentación pública de Resend
// (resend.com/docs/knowledge-base/403-error-resend-dev-domain y
// resend.com/docs/api-reference/errors) — no inventado.
//
// No se exige `statusCode`: el SDK de Node no siempre lo trae en el objeto
// de error (resend-node#286 lo documenta como ausente en versiones
// anteriores); el texto del mensaje es la señal estable entre versiones.
// Tampoco basta `name === "validation_error"` a secas — ese mismo nombre
// cubre otros errores de Resend (campo obligatorio ausente, dominio ya
// registrado...) que NO son esta restricción — por eso hace falta también
// el patrón del mensaje.
// ----------------------------------------------------------------------------
export interface ErrorComoResend {
  name?: string | null;
  statusCode?: number | null;
  message?: string | null;
}

export function esErrorSandboxResend(error: ErrorComoResend | null | undefined): boolean {
  if (!error) return false;
  const nombre = (error.name ?? "").toLowerCase();
  if (nombre !== "validation_error") return false;
  const mensaje = (error.message ?? "").toLowerCase();
  return mensaje.includes("own email address") || mensaje.includes("testing email");
}

// ----------------------------------------------------------------------------
// Rate limit (punto 5 del encargo) — decisión pura. El conteo real (leer/
// escribir `rate_limit_log`, tabla genérica {id, identifier, created_at} ya
// aplicada en la BD y sin ningún uso todavía) vive en index.ts.
// ----------------------------------------------------------------------------
export function superaLimiteDePrueba(conteoReciente: number, limite: number): boolean {
  return conteoReciente >= limite;
}
