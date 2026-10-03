// ============================================================================
// EDICIÓN DE UNA RESERVA EXISTENTE — reglas puras, sin I/O.
//
// Encargo del dueño (2026-09-30): las reservas se tienen que poder EDITAR
// SIEMPRE desde el panel — en cualquier estado (pendiente, verificada,
// confirmada, cancelada, «Llegó», «No vino»), con cualquier fecha (también
// pasadas) y de cualquier canal. «Editar» es cambiar los DATOS (nombre,
// teléfono, email, día, hora, comensales, sala, notas, importante); el ESTADO
// sigue cambiándose con las acciones de siempre (Aceptar, Verificar,
// Confirmar, Cancelar, Ha llegado, No vino…), que tienen efectos propios
// (correos, llegada, mesa).
//
// POR QUÉ SE GUARDA SOLO EL DIFF (no la fila entera)
// ----------------------------------------------------------------------------
// El trigger `trg_validar_capacidad` de la BD es `BEFORE INSERT OR UPDATE OF
// fecha, hora, numero_comensales, estado`: se dispara si esas columnas figuran
// en el SET aunque el valor no cambie. Con un UPDATE de fila entera, corregir
// una errata en el nombre de una reserva de un turno que ya está lleno
// fallaría con «Aforo superado». Mandando solo lo que cambia:
//   · un cambio de nombre/notas/sala/importante nunca toca el aforo;
//   · `estado`, `canal`, `marca`, `llegada_at` y compañía jamás se escriben
//     desde aquí (así `trg_reservas_limpiar_llegada` ni se entera);
//   · dos personas editando campos distintos de la misma reserva no se pisan.
//
// Y la BD, por su lado, ya tolera el resto (revisado en producción):
//   · `validar_capacidad_reserva` solo valida estados vivos (pendiente,
//     verificada, confirmada) y no cuenta la propia reserva;
//   · `reservas_sincronizar_asignaciones` quita las mesas al cambiar de sala y
//     las mueve (o las descarta, sin fallar) al cambiar de día o de turno;
//   · la política RLS de UPDATE solo mira el permiso de la sección, no el
//     estado ni la fecha.
// (desfasado tras aplicar 20260930212000)
// ============================================================================
import { format } from "date-fns";
import { ESTADOS_QUE_OCUPAN, turnoDeHora } from "../../../supabase/functions/_shared/disponibilidad";
// La regla del canal que no recibe «solicitud recibida» (la web) vive en la Edge
// Function; se importa la misma para que panel y servidor no puedan divergir.
import { debeEnviarSolicitudRecibida } from "../../../supabase/functions/emails-reserva/plantillas";
import {
  debeNotificarAltaPanel,
  emailParaGuardar,
  errorEmailOpcional,
  errorTelefono,
  esErrorSinPermiso,
  PEDIR_PERMISO_EDICION,
} from "./altaPanel";
import { horaCorta } from "./ocupacionSalas";
import { esErrorSalaPrivadaOcupada, mensajeSalaPrivadaOcupada } from "./salaPrivada";
import { formatearTelefonoReserva } from "./telefono";

/** La fila de `reservas` que necesita el editor (el resto de columnas ni se lee ni se escribe). */
export interface ReservaEditable {
  id: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  /** "yyyy-MM-dd" */
  fecha: string;
  /** "HH:MM" o "HH:MM:SS" */
  hora: string;
  numero_comensales: number;
  estado: string;
  notas_cliente: string | null;
  espacio_id: string | null;
  /** Se lee (la comprobación de aforo mira la marca de la reserva) pero nunca se edita. */
  marca?: string | null;
  canal?: string | null;
  importante?: boolean | null;
  en_blacklist?: boolean | null;
}

/** Lo que cuenta en el aforo del turno: pendiente, verificada y confirmada. */
export function esReservaViva(estado: string | null | undefined): boolean {
  return (ESTADOS_QUE_OCUPAN as readonly string[]).includes(estado ?? "");
}

/** Valores con los que arranca el formulario de edición. */
export interface ValoresFormularioEdicion {
  nombre: string;
  telefono: string;
  email: string;
  fecha: Date;
  hora: string;
  numero_comensales: number;
  notas_cliente: string;
  espacio_id: string | null;
  importante: boolean;
}

/** "2026-10-10" → esa fecha a MEDIODÍA local (un `new Date("2026-10-10")` es UTC y en husos negativos cae el día anterior). */
function fechaLocal(ymd: string): Date {
  return new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
}

export function valoresFormularioDesdeReserva(reserva: ReservaEditable): ValoresFormularioEdicion {
  return {
    nombre: reserva.nombre ?? "",
    telefono: reserva.telefono ?? "",
    email: reserva.email ?? "",
    fecha: fechaLocal(reserva.fecha),
    hora: horaCorta(reserva.hora) ?? "",
    numero_comensales: Number(reserva.numero_comensales) || 0,
    notas_cliente: reserva.notas_cliente ?? "",
    espacio_id: reserva.espacio_id ?? null,
    importante: !!reserva.importante,
  };
}

/** Lo que el usuario deja en el formulario (el mismo shape que el alta). */
export interface ValoresEditados {
  nombre: string;
  telefono: string;
  email?: string | null;
  fecha: Date;
  hora: string;
  numero_comensales: number;
  notas_cliente?: string | null;
  espacio_id?: string | null;
  importante?: boolean;
}

/** Columnas de `reservas` que puede tocar una edición. Ninguna otra. */
export interface CambiosReserva {
  nombre?: string;
  telefono?: string | null;
  email?: string | null;
  fecha?: string;
  hora?: string;
  numero_comensales?: number;
  notas_cliente?: string | null;
  espacio_id?: string | null;
  importante?: boolean;
  /** Solo si cambia el teléfono o el email y el resultado de la lista negra difiere de lo guardado. */
  en_blacklist?: boolean;
}

export type CampoEditable =
  | "nombre"
  | "telefono"
  | "email"
  | "fecha"
  | "hora"
  | "numero_comensales"
  | "notas_cliente"
  | "espacio_id"
  | "importante";

/** Orden y nombre (en castellano) con los que se cuentan los campos cambiados. */
export const ETIQUETA_CAMPO: Record<CampoEditable, string> = {
  nombre: "nombre",
  telefono: "teléfono",
  email: "email",
  fecha: "fecha",
  hora: "hora",
  numero_comensales: "comensales",
  notas_cliente: "notas",
  espacio_id: "sala",
  importante: "importante",
};

const CAMPOS: readonly CampoEditable[] = Object.keys(ETIQUETA_CAMPO) as CampoEditable[];

/**
 * El diff entre lo guardado y lo que el usuario deja en el formulario. Vacío =
 * no hay nada que guardar.
 *
 * `opciones.enListaNegra` es el resultado de comprobar la lista negra con el
 * contacto NUEVO (`undefined` = no se ha comprobado). Solo se escribe
 * `en_blacklist` si el teléfono o el email cambian y el resultado difiere de la
 * marca guardada; el ESTADO no se toca nunca (en el alta una reserva de la
 * lista negra nace `pendiente`, pero cambiar el estado aquí no toca).
 */
export function calcularCambiosEdicion(
  original: ReservaEditable,
  editado: ValoresEditados,
  opciones: { enListaNegra?: boolean | null } = {},
): CambiosReserva {
  const cambios: CambiosReserva = {};

  const nombre = editado.nombre.trim();
  if (nombre !== (original.nombre ?? "").trim()) cambios.nombre = nombre;

  // Si el texto no se ha tocado, ni se normaliza ni cuenta: un teléfono antiguo
  // guardado "a la antigua" no se reescribe por abrir el formulario.
  const telefonoBruto = (editado.telefono ?? "").trim();
  if (telefonoBruto !== (original.telefono ?? "").trim()) {
    const telefono = formatearTelefonoReserva(telefonoBruto);
    if (telefono !== (original.telefono ?? null)) cambios.telefono = telefono;
  }

  const email = emailParaGuardar(editado.email);
  if (email !== emailParaGuardar(original.email)) cambios.email = email;

  const fecha = format(editado.fecha, "yyyy-MM-dd");
  if (fecha !== String(original.fecha).slice(0, 10)) cambios.fecha = fecha;

  // La hora se compara sin segundos: "21:00:00" (BD) y "21:00" (formulario) son
  // la misma. Al escribirla se usa el formato corto, como hace el alta.
  const hora = horaCorta(editado.hora);
  if (hora && hora !== horaCorta(original.hora)) cambios.hora = hora;

  const comensales = Number(editado.numero_comensales);
  if (comensales !== Number(original.numero_comensales)) cambios.numero_comensales = comensales;

  const notas = (editado.notas_cliente ?? "").trim() || null;
  if (notas !== ((original.notas_cliente ?? "").trim() || null)) cambios.notas_cliente = notas;

  const sala = editado.espacio_id || null;
  if (sala !== (original.espacio_id ?? null)) cambios.espacio_id = sala;

  if (editado.importante !== undefined && !!editado.importante !== !!original.importante) {
    cambios.importante = !!editado.importante;
  }

  const cambiaContacto = "telefono" in cambios || "email" in cambios;
  if (cambiaContacto && opciones.enListaNegra != null && !!opciones.enListaNegra !== !!original.en_blacklist) {
    cambios.en_blacklist = !!opciones.enListaNegra;
  }

  return cambios;
}

/** Campos del formulario que cambian (sin la marca de lista negra, que no es un campo). */
export function camposCambiados(cambios: CambiosReserva): CampoEditable[] {
  return CAMPOS.filter((campo) => campo in cambios);
}

/** "nombre", "hora y comensales", "nombre, teléfono y fecha". Vacío si no hay cambios. */
export function textoCamposCambiados(cambios: CambiosReserva): string {
  const nombres = camposCambiados(cambios).map((c) => ETIQUETA_CAMPO[c]);
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/** ¿El cambio toca lo que mira `trg_validar_capacidad`? (día, hora o comensales). */
export function cambiaAforo(cambios: CambiosReserva): boolean {
  return "fecha" in cambios || "hora" in cambios || "numero_comensales" in cambios;
}

/**
 * Validación del nombre al EDITAR: un nombre heredado que hoy no pasaría el alta
 * ("J") no bloquea la edición de otra cosa; en cuanto se toca, se exige como en
 * el alta (mínimo 2 caracteres).
 */
export function errorNombreEdicion(nuevo: string | null | undefined, original: string | null | undefined): string | null {
  const limpio = (nuevo ?? "").trim();
  if (limpio === (original ?? "").trim()) return null;
  return limpio.length >= 2 ? null : "El nombre es obligatorio";
}

/**
 * Igual para el teléfono: lo heredado sin tocar (incluso vacío o raro) no
 * bloquea; lo que se toca se valida como en el alta (`errorTelefono`).
 */
export function errorTelefonoEdicion(
  nuevo: string | null | undefined,
  original: string | null | undefined,
): string | null {
  if ((nuevo ?? "").trim() === (original ?? "").trim()) return null;
  return errorTelefono(nuevo);
}

/**
 * Y el email: opcional, pero con formato si se escribe. Lo heredado sin tocar
 * ("josé@gmail.com", que la validación nativa del navegador rechaza, o uno que
 * hoy no pasaría el alta) no bloquea cambiar otra cosa; en cuanto se toca, se
 * valida como en el alta (`errorEmailOpcional`). Quitarlo (vacío) es válido.
 */
export function errorEmailEdicion(nuevo: string | null | undefined, original: string | null | undefined): string | null {
  if (emailParaGuardar(nuevo) === emailParaGuardar(original)) return null;
  return errorEmailOpcional(nuevo);
}

/**
 * ¿Hay que pedirle a `notify-reservation-change` que escriba al cliente tras
 * esta edición?
 *
 * La MISMA regla que el alta del panel (`debeNotificarAltaPanel`: solo una
 * reserva `verificada` manda «Confirma tu reserva») aplicada al único caso en
 * que una edición la activa: el email cambia y queda uno. Además:
 *   · nunca a un cliente en lista negra (queda pendiente de revisión);
 *   · nunca para un día que ya pasó.
 * Un cambio de día, hora o comensales va por OTRO correo, el aviso de
 * «reserva modificada» (`disponibilidadAvisoModificacion`), que a una
 * verificada ya le lleva un enlace nuevo: si ese aviso se pide, este no (el
 * formulario no manda los dos). Y ojo, que `emails-reserva` es idempotente por
 * (reserva, tipo): si «Confirma tu reserva» ya se envió a la dirección
 * anterior, no se repite a la nueva.
 */
export function debeNotificarEdicion(
  original: ReservaEditable,
  cambios: CambiosReserva,
  opciones: { hoy: string; enListaNegra: boolean },
): boolean {
  if (!debeNotificarAltaPanel(original.estado)) return false;
  if (!("email" in cambios) || !cambios.email) return false;
  if (opciones.enListaNegra) return false;
  return (cambios.fecha ?? String(original.fecha).slice(0, 10)) >= opciones.hoy;
}

/**
 * El enlace del correo «Confirma tu reserva» lleva una huella de la reserva
 * (`v2|estado|HH:MM`, en `emails-reserva/tokens.ts`): cambia la HORA y el enlace
 * que el cliente ya tiene en su bandeja pasa a «enlace no válido» (cambiar el día
 * o los comensales NO lo invalida). «Confirma tu reserva» no se reenvía (es
 * idempotente por reserva y tipo): el enlace nuevo solo le llega con el aviso de
 * «reserva modificada» (casilla «Avisar al cliente del cambio», ver
 * TEXTO_ENLACE_NUEVO). Este texto es para cuando ese aviso no se pide o no sale.
 */
export const TEXTO_ENLACE_INVALIDADO =
  "El enlace de «Confirma tu reserva» que ya recibió el cliente deja de valer al cambiar la hora: confírmala tú o llámale.";

/**
 * ¿Esta edición deja sin valor el enlace «Confirma tu reserva» que el cliente ya
 * recibió? Solo si la reserva está `verificada` (la única que lo lleva), TENÍA
 * email (se le mandó a esa dirección), la hora cambia y el día sigue sin haber
 * pasado. Si el email se pone en esa misma edición no hay enlace viejo: el
 * correo sale ya con la hora nueva.
 */
export function invalidaEnlaceConfirmacion(
  original: ReservaEditable,
  cambios: CambiosReserva,
  opciones: { hoy: string },
): boolean {
  if (original.estado !== "verificada") return false;
  if (!("hora" in cambios)) return false;
  if (!emailParaGuardar(original.email)) return false;
  return (cambios.fecha ?? String(original.fecha).slice(0, 10)) >= opciones.hoy;
}

/**
 * Con «Avisar al cliente del cambio» marcada, el correo de «reserva modificada»
 * de una VERIFICADA lleva un enlace «Confirma tu reserva» NUEVO (firmado con la
 * hora nueva). Es el aviso previo en ese caso; TEXTO_ENLACE_INVALIDADO se queda
 * para cuando la casilla se desmarca (o el aviso no llega a salir).
 */
export const TEXTO_ENLACE_NUEVO =
  "El enlace de «Confirma tu reserva» que ya recibió el cliente deja de valer al cambiar la hora: con el aviso del cambio se le manda uno nuevo.";

/**
 * La casilla «Avisar al cliente del cambio» del formulario de edición:
 *   · mostrar: la edición cambia el día, la hora o los comensales (si no, no hay
 *     nada que avisar y ni se enseña);
 *   · disponible: se puede avisar, así que sale habilitada y MARCADA por
 *     defecto: la reserva está viva, no ha pasado (día Y hora tal y como queda),
 *     no es una web 'pendiente' (aún no ha recibido ningún correo: el primero
 *     será la propuesta), tiene email (el de después de la edición) y el
 *     cliente no está en la lista negra;
 *   · motivo: por qué no, para enseñarlo junto a la casilla deshabilitada.
 * `ahora` = "yyyy-MM-ddTHH:mm" en hora local (la del restaurante). Es la misma
 * regla que vuelve a aplicar `emails-reserva` (reserva-modificada.ts): el
 * servidor no se fía del navegador.
 */
export interface DisponibilidadAvisoModificacion {
  mostrar: boolean;
  disponible: boolean;
  motivo: string | null;
}

export function disponibilidadAvisoModificacion(
  original: ReservaEditable,
  cambios: CambiosReserva,
  opciones: { ahora: string; enListaNegra: boolean },
): DisponibilidadAvisoModificacion {
  if (!cambiaAforo(cambios)) return { mostrar: false, disponible: false, motivo: null };
  const no = (motivo: string): DisponibilidadAvisoModificacion => ({ mostrar: true, disponible: false, motivo });
  if (!esReservaViva(original.estado)) {
    return no(
      original.estado === "cancelada"
        ? "La reserva está cancelada: no se avisa al cliente."
        : "La reserva ya está cerrada («Llegó» o «No vino»): no se avisa al cliente.",
    );
  }
  const fecha = cambios.fecha ?? String(original.fecha).slice(0, 10);
  const hora = horaCorta(cambios.hora ?? original.hora) ?? "00:00";
  if (`${fecha}T${hora}` <= opciones.ahora) return no("La reserva ya ha pasado: no se avisa al cliente.");
  // La web pendiente no recibe ningún correo hasta la propuesta (decisión del
  // dueño 2026-09-28): avisarle del cambio sería el doble correo que se quitó.
  if (original.estado === "pendiente" && !debeEnviarSolicitudRecibida(original.canal)) {
    return no("Aún no ha recibido ningún correo: le llegará la propuesta al verificarla.");
  }
  const email = "email" in cambios ? cambios.email : emailParaGuardar(original.email);
  if (!email) return no("No tiene email: si hace falta, avísale por teléfono.");
  if (opciones.enListaNegra) return no("El cliente está en la lista negra: no se le escribe.");
  return { mostrar: true, disponible: true, motivo: null };
}

/**
 * Lo que el panel manda a `emails-reserva/notificar-modificacion` como «antes»:
 * la reserva tal y como estaba al abrir el editor. Lo de AHORA lo lee la
 * función de la BD (ya guardado), no se le manda.
 */
export function antesDeLaEdicion(original: ReservaEditable): { fecha: string; hora: string; comensales: number } {
  return {
    fecha: String(original.fecha).slice(0, 10),
    hora: horaCorta(original.hora) ?? String(original.hora).slice(0, 5),
    comensales: Number(original.numero_comensales),
  };
}

/**
 * Qué pasó con el correo «Confirma tu reserva» que se pidió al cambiar el email:
 *   · enviado: `emails-reserva` dice que salió;
 *   · ya_enviado: ya se había enviado (un rebote también ocupa ese hueco) o está
 *     en curso: NO se repite;
 *   · suprimido: la dirección está bloqueada (rebotó o se quejó);
 *   · no_enviado: otro motivo (se conserva en `motivo`);
 *   · pedido: se pidió, pero la respuesta no dice si salió (no se afirma nada);
 *   · fallo: ni siquiera se pudo pedir.
 */
export interface EnvioCorreoEdicion {
  resultado: "enviado" | "ya_enviado" | "suprimido" | "no_enviado" | "pedido" | "fallo";
  /** Solo con `no_enviado`: el `motivo` tal cual lo devuelve `emails-reserva`. */
  motivo?: string;
}

/**
 * Lee lo que devuelve `supabase.functions.invoke("notify-reservation-change")`.
 * El proxy contesta `{ success, status, resultado }` con el texto JSON de
 * `emails-reserva` (`{ ok, motivo? }`) dentro de `resultado`; si no es legible,
 * solo se sabe que se pidió. Nunca lanza.
 */
export function interpretarRespuestaNotificacion(respuesta: unknown): EnvioCorreoEdicion {
  const { data, error } = (respuesta ?? {}) as { data?: unknown; error?: unknown };
  if (error) return { resultado: "fallo" };
  const cuerpo = (data && typeof data === "object" ? data : {}) as { success?: unknown; resultado?: unknown };
  if (cuerpo.success === false) return { resultado: "fallo" };

  return resultadoDeEmailsReserva(cuerpo.resultado);
}

/** El `{ ok, motivo? }` de `emails-reserva` (objeto o texto JSON) → lo que pasó. */
function resultadoDeEmailsReserva(respuesta: unknown): EnvioCorreoEdicion {
  let detalle: unknown = respuesta;
  if (typeof detalle === "string") {
    try {
      detalle = JSON.parse(detalle);
    } catch {
      detalle = null;
    }
  }
  const { ok, motivo } = (detalle && typeof detalle === "object" ? detalle : {}) as { ok?: unknown; motivo?: unknown };
  if (ok === true) return { resultado: "enviado" };
  if (typeof motivo === "string" && motivo) {
    if (motivo === "ya_enviado_o_en_curso") return { resultado: "ya_enviado" };
    if (motivo === "destinatario_suprimido") return { resultado: "suprimido" };
    return { resultado: "no_enviado", motivo };
  }
  return { resultado: "pedido" };
}

/**
 * Lee lo que devuelve `supabase.functions.invoke("emails-reserva/notificar-modificacion")`.
 * Aquí no hay proxy: `data` ES el `{ ok, motivo? }` de `emails-reserva`. Un
 * `error` (sin permiso, la función aún sin desplegar —404—, red) es `fallo`.
 * Nunca lanza.
 */
export function interpretarRespuestaAvisoModificacion(respuesta: unknown): EnvioCorreoEdicion {
  const { data, error } = (respuesta ?? {}) as { data?: unknown; error?: unknown };
  if (error) return { resultado: "fallo" };
  return resultadoDeEmailsReserva(data);
}

/** Frase para el personal según lo que pasó con el correo (sin afirmar nunca más de lo que se sabe). */
function textoEnvioCorreo(envio: EnvioCorreoEdicion): string {
  switch (envio.resultado) {
    case "enviado":
      return "Se le ha enviado el correo «Confirma tu reserva» al nuevo email.";
    case "ya_enviado":
      return "No se ha enviado nada al nuevo email: «Confirma tu reserva» ya se le había enviado antes (aunque rebotara) o está en curso, y NO se repite: confírmala tú o llámale.";
    case "suprimido":
      return "No se ha enviado «Confirma tu reserva»: ese email está bloqueado porque antes rebotó o se quejó. Llámale.";
    case "no_enviado":
      return `No se ha podido enviar «Confirma tu reserva» (${envio.motivo}). Llámale.`;
    case "fallo":
      return "No se ha podido pedir el envío del correo «Confirma tu reserva»: avísale por teléfono.";
    default:
      return "Se ha pedido el envío del correo «Confirma tu reserva» al nuevo email, pero no consta que haya salido (si ya se le envió uno antes, no se repite).";
  }
}

/** Motivos de `emails-reserva/notificar-modificacion` que se explican en claro. */
const TEXTO_AVISO_NO_ENVIADO: Record<string, string> = {
  fallido_reintentable:
    "El aviso del cambio aún no ha salido (ha fallado el envío): se reintentará solo en los próximos minutos. Si al final no sale, lo verás en la campana.",
  sin_cambios: "No se ha enviado el aviso: el día, la hora y los comensales quedan como el cliente ya los tenía.",
  reserva_pasada: "No se ha enviado el aviso: la reserva ya ha pasado.",
  reserva_no_viva: "No se ha enviado el aviso: la reserva ya no está activa.",
  reserva_sin_email: "No se ha enviado el aviso: la reserva no tiene email. Si hace falta, llámale.",
  en_lista_negra: "No se ha enviado el aviso: el cliente está en la lista negra.",
  reserva_de_prueba: "No se ha enviado el aviso: es una reserva de prueba.",
  pendiente_sin_correo_previo:
    "No se ha enviado el aviso: aún no ha recibido ningún correo; le llegará la propuesta al verificarla.",
  cambio_no_reciente:
    "No se ha enviado el aviso: la reserva no consta como recién guardada. Vuelve a abrirla o llámale.",
  demasiados_avisos: "No se ha enviado el aviso: se han pedido demasiados seguidos. Espera unos minutos o llámale.",
  plantilla_no_configurada_reserva_modificada:
    "No se ha enviado el aviso: falta la plantilla «Reserva modificada» (hay que aplicar su migración). Llámale.",
  migracion_pendiente:
    "No se ha enviado el aviso: falta aplicar la migración del correo «Reserva modificada». Llámale.",
};

/** Frase para el personal según lo que pasó con el aviso del cambio (sin afirmar más de lo que se sabe). */
function textoAvisoModificacion(envio: EnvioCorreoEdicion, estado: string): string {
  switch (envio.resultado) {
    case "enviado":
      return estado === "verificada"
        ? "Se le ha enviado al cliente un correo con el cambio y un enlace nuevo para confirmar la reserva."
        : "Se le ha enviado al cliente un correo con el cambio.";
    case "ya_enviado":
      return "No se ha enviado otro correo: el cliente ya tiene un aviso con estos mismos datos (o se le está enviando ahora).";
    case "suprimido":
      return "No se ha enviado el aviso del cambio: ese email está bloqueado porque antes rebotó o se quejó. Llámale.";
    case "no_enviado":
      return (
        TEXTO_AVISO_NO_ENVIADO[envio.motivo ?? ""] ??
        `No se ha podido enviar el aviso del cambio (${envio.motivo}). Llámale.`
      );
    case "fallo":
      return "No se ha podido pedir el envío del aviso del cambio: avísale por teléfono.";
    default:
      return "Se ha pedido el envío del aviso del cambio, pero no consta que haya salido.";
  }
}

/**
 * Frase para el aviso de «guardado»: lo ÚNICO que el personal no puede
 * comprobar mirando la pantalla es si el cliente se entera del cambio. Mismo
 * criterio que `avisoAlCliente` de las acciones de estado: decir qué NO ha
 * pasado para que nadie dé por hecho que ya se le ha avisado.
 *   · se pidió el aviso de «reserva modificada» (`avisoModificacion`) → qué ha
 *     pasado de verdad con ese correo, según lo que contestó `emails-reserva`;
 *   · se pidió «Confirma tu reserva» (`envio`) → igual, con ese correo;
 *   · cambia día, hora o comensales de una reserva viva que aún no ha pasado y
 *     no se pidió el aviso (casilla desmarcada, o sin poder avisar) → el
 *     cliente no recibe nada, y se dice;
 *   · cualquier otra cosa → nada que decir (`null`).
 */
export function avisoAlClienteTrasEdicion(
  original: ReservaEditable,
  cambios: CambiosReserva,
  opciones: { hoy: string; envio?: EnvioCorreoEdicion | null; avisoModificacion?: EnvioCorreoEdicion | null },
): string | null {
  if (opciones.avisoModificacion) return textoAvisoModificacion(opciones.avisoModificacion, original.estado);
  if (opciones.envio) return textoEnvioCorreo(opciones.envio);
  if (!cambiaAforo(cambios) || !esReservaViva(original.estado)) return null;
  if ((cambios.fecha ?? String(original.fecha).slice(0, 10)) < opciones.hoy) return null;
  const email = "email" in cambios ? cambios.email : emailParaGuardar(original.email);
  return email
    ? "El cliente no recibe ningún aviso de este cambio."
    : "No tiene email: si hace falta, avísale por teléfono.";
}

/**
 * ¿Hay que avisar, DESPUÉS de guardar, de que el enlace «Confirma tu reserva»
 * que ya tenía el cliente ha dejado de valer? Si la edición lo rompe
 * (`invalidaEnlaceConfirmacion`) y NO consta que tenga ya uno nuevo: el aviso
 * del cambio no se pidió (casilla desmarcada) o no salió. Si salió, o el cliente
 * ya tenía un aviso con estos mismos datos (y su enlace, que con la misma hora
 * vuelve a valer), no hace falta.
 */
export function enlaceQuedaRoto(
  original: ReservaEditable,
  cambios: CambiosReserva,
  opciones: { hoy: string; avisoModificacion?: EnvioCorreoEdicion | null },
): boolean {
  if (!invalidaEnlaceConfirmacion(original, cambios, { hoy: opciones.hoy })) return false;
  const resultado = opciones.avisoModificacion?.resultado;
  return resultado !== "enviado" && resultado !== "ya_enviado";
}

/**
 * Qué hace la BD con las mesas de la reserva al guardar (trigger
 * `trg_reservas_sincronizar_asignaciones`), para avisarlo ANTES de guardar:
 *   · "quita": cambia la sala → se borran sus mesas;
 *   · "mueve": cambia el día o el turno (corte 17:00) → la mesa se mantiene si
 *     está libre ese día y turno; si no, la reserva se queda pendiente de mesa;
 *   · null: cambiar la hora dentro del mismo turno, los comensales o los datos
 *     de contacto no toca las mesas.
 */
export type EfectoEnMesas = "quita" | "mueve" | null;

export function efectoEnMesas(original: ReservaEditable, cambios: CambiosReserva): EfectoEnMesas {
  if ("espacio_id" in cambios) return "quita";
  if ("fecha" in cambios) return "mueve";
  if ("hora" in cambios && turnoDeHora(cambios.hora as string) !== turnoDeHora(original.hora)) return "mueve";
  return null;
}

/** La escritura no tocó ninguna fila: RLS la ha filtrado en silencio (o la reserva ya no existe). */
export class ErrorSinFilasEdicion extends Error {
  constructor() {
    super("No tienes permiso para editar esta reserva, o ya no existe.");
    this.name = "ErrorSinFilasEdicion";
  }
}

/** Mensaje legible para un fallo al guardar (mismo estilo que el alta). */
export function mensajeErrorEdicion(error: unknown): string {
  if (error instanceof ErrorSinFilasEdicion) return error.message;
  const e = (error ?? {}) as { code?: string; message?: string };
  const mensaje = String(e.message ?? "");
  // Sala privada (el Reservado) ya reservada en ese turno: el mensaje lleva el nombre de la sala.
  if (esErrorSalaPrivadaOcupada(e)) return mensajeSalaPrivadaOcupada(e);
  // 23514 = check_violation: lo lanza el trigger de aforo, pero también los CHECK de la tabla.
  if (e.code === "23514" && mensaje.includes("Aforo")) {
    return "No hay aforo suficiente en ese turno. Elige otra hora o reduce los comensales.";
  }
  if (esErrorSinPermiso(e)) return `No tienes permiso para editar reservas. ${PEDIR_PERMISO_EDICION}`;
  return `Error al guardar los cambios: ${mensaje || "error desconocido"}`;
}
