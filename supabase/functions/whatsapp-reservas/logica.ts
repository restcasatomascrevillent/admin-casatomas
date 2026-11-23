// ============================================================================
// WHATSAPP-RESERVAS — lógica pura (sin Deno ni red), probada con vitest
// ============================================================================
// Avisos de reserva por WhatsApp (API de WhatsApp Cloud de Meta) para los
// clientes que eligen ese canal al reservar (`reservas.canal_avisos`). Es la
// prueba de concepto pedida por el dueño (21/11/2026); ver
// docs/funcionalidades/whatsapp-reservas.md.
//
// Qué hay aquí:
//   · Las plantillas que se registran en Meta (una por tipo de aviso). Meta
//     solo deja escribir primero a un cliente con una plantilla aprobada.
//   · El teléfono de la reserva en el formato que pide WhatsApp (34612345678).
//   · Los botones «Sí, confirmo» / «No puedo, cancelar». El dato oculto de
//     cada botón (payload) es una versión CORTA y firmada del token de los
//     correos: el token de emails-reserva/tokens.ts ocupa ~200 caracteres y
//     el límite del payload de Meta no está claro (128 o 256 según la fuente).
//     Al pulsar, index.ts lo comprueba y firma el token normal con la MISMA
//     huella (`v2|verificada|HH:MM`), así que si el restaurante cambia la hora
//     después de mandar el WhatsApp, el botón viejo deja de valer, igual que
//     el enlace del correo.
//   · La lectura del webhook de Meta (pulsaciones y estados de entrega) y la
//     comprobación de su firma (cabecera X-Hub-Signature-256).
//   · El texto que se contesta en el chat tras pulsar un botón.
// ============================================================================

import { NEGOCIOS, NEGOCIO_POR_DEFECTO, esMarcaValida, type Marca } from "../reservas-web/plantillas.ts";

// ----------------------------------------------------------------------------
// Plantillas de Meta
// ----------------------------------------------------------------------------

/** Tipos de aviso que ya tienen plantilla de WhatsApp. El resto (recordatorio,
 * reserva modificada) sigue yendo por correo. */
export type TipoAvisoWhatsApp = "solicitud_recibida" | "propuesta" | "confirmada" | "rechazada";

export const TIPOS_AVISO_WHATSAPP: readonly TipoAvisoWhatsApp[] = ["solicitud_recibida", "propuesta", "confirmada", "rechazada"];

export function esTipoAvisoWhatsApp(tipo: unknown): tipo is TipoAvisoWhatsApp {
  return typeof tipo === "string" && (TIPOS_AVISO_WHATSAPP as readonly string[]).includes(tipo);
}

/** Tipo de aviso según el estado de la reserva. A diferencia del correo, la
 * reserva recibida ('pendiente') SÍ se avisa también si viene de la web: el
 * cliente eligió WhatsApp y el primer mensaje lleva «Gestionar mi reserva»
 * y «Ver la carta» (decisión del dueño, 21/11/2026). */
export function tipoAvisoParaEstado(estado: string): TipoAvisoWhatsApp | null {
  switch (estado) {
    case "pendiente":
      return "solicitud_recibida";
    case "verificada":
      return "propuesta";
    case "confirmada":
      return "confirmada";
    case "cancelada":
      return "rechazada";
    default:
      return null;
  }
}

/** Español de España. Tiene que coincidir con el idioma con el que se registró la plantilla. */
export const IDIOMA_PLANTILLAS = "es_ES";

/** Botón de una plantilla:
 *  - `respuesta`: respuesta rápida; al pulsarlo Meta nos manda su payload.
 *  - `url`: abre un enlace. Si la URL acaba en {{1}}, el final se rellena al
 *    enviar (Meta solo deja variable al final de la URL). */
export type BotonPlantilla =
  | { tipo: "respuesta"; texto: string; accion: AccionBoton }
  | { tipo: "url"; texto: string; url: string; ejemploSufijo?: string; sufijo?: "gestionar" | "mapa" };

export interface DefinicionPlantilla {
  tipo: TipoAvisoWhatsApp;
  /** Nombre en Meta: minúsculas y guiones bajos. */
  nombre: string;
  /** Texto con variables {{1}}, {{2}}… Meta rechaza una plantilla que empiece
   * o acabe en variable, así que siempre hay texto antes y después. */
  cuerpo: string;
  /** Un valor de ejemplo por variable (Meta los pide para revisarla). */
  ejemplo: string[];
  /** Máximo 25 caracteres por texto. Las respuestas rápidas van juntas y primero. */
  botones: BotonPlantilla[];
}

const MAPA_GOOGLE = "https://www.google.com/maps/search/?api=1&query=";

/**
 * Las plantillas de Casa Tomás. Los enlaces van a `web` (la web de la demo
 * mientras se prueba con el número de prueba de Meta; la de producción
 * cuando haya número real, que irá en otra cuenta de WhatsApp con sus
 * propias plantillas). Mismos mensajes que los correos (migración
 * 20260920010000).
 */
export function plantillas(web: string): Readonly<Record<TipoAvisoWhatsApp, DefinicionPlantilla>> {
  const base = web.replace(/\/+$/, "");
  const gestionar: BotonPlantilla = {
    tipo: "url",
    texto: "Gestionar mi reserva",
    url: `${base}/reserva/respuesta?token={{1}}`,
    ejemploSufijo: "eyJpZCI6ImVqZW1wbG8ifQ.ZmlybWE",
    sufijo: "gestionar",
  };
  const comoLlegar: BotonPlantilla = {
    tipo: "url",
    texto: "Cómo llegar",
    url: `${MAPA_GOOGLE}{{1}}`,
    ejemploSufijo: "Casa%20Tom%C3%A1s%20Crevillente",
    sufijo: "mapa",
  };
  return {
    solicitud_recibida: {
      tipo: "solicitud_recibida",
      nombre: "reserva_recibida",
      cuerpo:
        "Hola {{1}}, hemos recibido tu solicitud de reserva en {{2}}:\n\n📅 {{3}}\n🕘 {{4}} h\n👥 {{5}} personas\n\n" +
        "La revisaremos y te escribiremos por aquí para que la confirmes. Mientras, puedes ver tu reserva o echar un vistazo a la carta.",
      ejemplo: ["Ana", "Casa Tomás", "sábado 12 de diciembre", "21:30", "4"],
      botones: [gestionar, { tipo: "url", texto: "Ver la carta", url: `${base}/carta` }],
    },
    propuesta: {
      tipo: "propuesta",
      nombre: "reserva_confirmar_asistencia",
      cuerpo:
        "Hola {{1}}, tu mesa en {{2}} está casi lista:\n\n📅 {{3}}\n🕘 {{4}} h\n👥 {{5}} personas\n\n" +
        "¿Confirmas tu asistencia? Si no confirmas, la mesa puede quedar libre para otros clientes.",
      ejemplo: ["Ana", "Casa Tomás", "sábado 12 de diciembre", "21:30", "4"],
      botones: [
        { tipo: "respuesta", texto: "Sí, confirmo", accion: "aceptar" },
        { tipo: "respuesta", texto: "No puedo, cancelar", accion: "rechazar" },
        comoLlegar,
      ],
    },
    confirmada: {
      tipo: "confirmada",
      nombre: "reserva_confirmada",
      cuerpo:
        "Hola {{1}}, tu reserva en {{2}} queda confirmada ✅\n\n📅 {{3}}\n🕘 {{4}} h\n👥 {{5}} personas\n\n" +
        "Si necesitas cambiarla o cancelarla, llámanos al {{6}} con antelación. ¡Te esperamos!",
      ejemplo: ["Ana", "Casa Tomás", "sábado 12 de diciembre", "21:30", "4", "966 10 78 87"],
      botones: [comoLlegar],
    },
    rechazada: {
      tipo: "rechazada",
      nombre: "reserva_no_disponible",
      cuerpo:
        "Hola {{1}}, lamentamos decirte que no ha sido posible confirmar tu reserva en {{2}} para el {{3}} a las {{4}} h.\n\n" +
        "Si quieres, llámanos al {{5}} y buscamos otra alternativa.",
      ejemplo: ["Ana", "Casa Tomás", "sábado 12 de diciembre", "21:30", "966 10 78 87"],
      botones: [],
    },
  };
}

/** Cuerpo de POST /{waba}/message_templates para registrar una plantilla. */
export function cuerpoCrearPlantilla(def: DefinicionPlantilla): Record<string, unknown> {
  const componentes: Record<string, unknown>[] = [
    { type: "BODY", text: def.cuerpo, example: { body_text: [def.ejemplo] } },
  ];
  if (def.botones.length > 0) {
    componentes.push({
      type: "BUTTONS",
      buttons: def.botones.map((b) => {
        if (b.tipo === "respuesta") return { type: "QUICK_REPLY", text: b.texto };
        const boton: Record<string, unknown> = { type: "URL", text: b.texto, url: b.url };
        // Meta pide un ejemplo de la URL completa cuando lleva variable.
        if (b.url.includes("{{1}}")) boton.example = [b.url.replace("{{1}}", b.ejemploSufijo ?? "ejemplo")];
        return boton;
      }),
    });
  }
  return { name: def.nombre, language: IDIOMA_PLANTILLAS, category: "UTILITY", components: componentes };
}

// ----------------------------------------------------------------------------
// Datos de la reserva -> variables de la plantilla
// ----------------------------------------------------------------------------

export interface ReservaParaWhatsApp {
  id: string;
  estado: string;
  nombre: string | null;
  telefono: string | null;
  /** ISO "YYYY-MM-DD" */
  fecha: string;
  /** "HH:MM" o "HH:MM:SS" */
  hora: string;
  numero_comensales: number;
  marca?: string | null;
}

export function negocioDeMarca(marca: unknown): { marca: Marca; nombre: string; telefonoTexto: string; direccion: string; localidad: string } {
  const m: Marca = esMarcaValida(marca) ? marca : NEGOCIO_POR_DEFECTO;
  const n = NEGOCIOS[m];
  return { marca: m, nombre: n.nombre, telefonoTexto: n.telefonoTexto, direccion: n.direccion, localidad: n.localidad };
}

/** Final de la URL de Google Maps («Cómo llegar») para el negocio de la reserva. */
export function consultaMapa(marca: unknown): string {
  const n = negocioDeMarca(marca);
  return encodeURIComponent(`${n.nombre}, ${n.direccion}, ${n.localidad}`);
}

/**
 * Teléfono para WhatsApp: solo dígitos y con prefijo de país (34612345678).
 * Un número español de 9 cifras sin prefijo se toma como +34. Devuelve `null`
 * si no parece un teléfono (WhatsApp lo rechazaría igualmente).
 */
export function telefonoParaWhatsApp(telefono: string | null | undefined): string | null {
  const t = (telefono ?? "").trim();
  if (!t) return null;
  let digitos = t.replace(/\D/g, "");
  if (!t.startsWith("+") && digitos.startsWith("00")) digitos = digitos.slice(2);
  else if (!t.startsWith("+") && digitos.length === 9) {
    if (!/^[6789]/.test(digitos)) return null;
    digitos = `34${digitos}`;
  }
  if (digitos.length < 10 || digitos.length > 15 || digitos.startsWith("0")) return null;
  return digitos;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-12-12" -> "sábado 12 de diciembre". Sin Intl: igual en cualquier entorno. */
export function fechaParaMensaje(fechaIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaIso || "");
  if (!m) return fechaIso || "";
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const diaSemana = DIAS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
  return `${diaSemana} ${dia} de ${MESES[mes - 1] ?? m[2]}`;
}

/** Meta rechaza variables vacías o con saltos de línea, tabuladores o más de 4 espacios seguidos. */
export function limpiarVariable(valor: unknown, porDefecto: string, maximo = 60): string {
  const limpio = String(valor ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, maximo).trim();
  return limpio || porDefecto;
}

/** Variables de la plantilla de cada tipo, en el orden {{1}}, {{2}}… */
export function variablesParaTipo(tipo: TipoAvisoWhatsApp, r: ReservaParaWhatsApp): string[] {
  const negocio = negocioDeMarca(r.marca);
  const nombre = limpiarVariable(r.nombre, "👋", 40);
  const fecha = fechaParaMensaje(r.fecha);
  const hora = (r.hora || "").slice(0, 5);
  const comensales = String(Number(r.numero_comensales) || 1);
  switch (tipo) {
    case "solicitud_recibida":
    case "propuesta":
      return [nombre, negocio.nombre, fecha, hora, comensales];
    case "confirmada":
      return [nombre, negocio.nombre, fecha, hora, comensales, negocio.telefonoTexto];
    case "rechazada":
      return [nombre, negocio.nombre, fecha, hora, negocio.telefonoTexto];
  }
}

/** Lo que va en cada botón al enviar: el payload de las respuestas rápidas y
 * el final de las URL con variable. Los botones sin nada que rellenar no se mandan. */
export interface ValoresBotones {
  /** Payload firmado por acción (ver firmarPayloadBoton). */
  payloads?: Partial<Record<AccionBoton, string>>;
  /** Token de «Gestionar mi reserva» (emails-reserva/tokens.ts, acción 'gestionar'). */
  tokenGestion?: string;
  /** Final de la URL de «Cómo llegar» (consultaMapa). */
  mapa?: string;
}

/** Cuerpo de POST /{phone-number-id}/messages con una plantilla. */
export function mensajePlantilla(opciones: {
  para: string;
  def: DefinicionPlantilla;
  variables: string[];
  botones?: ValoresBotones;
  /** Lo devuelve Meta en los estados de entrega (máx. 512 caracteres). */
  datosOpacos?: string;
}): Record<string, unknown> {
  const { para, def, variables, botones = {}, datosOpacos } = opciones;
  const componentes: Record<string, unknown>[] = [
    { type: "body", parameters: variables.map((text) => ({ type: "text", text })) },
  ];
  def.botones.forEach((b, i) => {
    if (b.tipo === "respuesta") {
      const payload = botones.payloads?.[b.accion];
      if (!payload) throw new Error(`falta_payload_${b.accion}`);
      componentes.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }] });
    } else if (b.url.includes("{{1}}")) {
      const valor = b.sufijo === "gestionar" ? botones.tokenGestion : botones.mapa;
      if (!valor) throw new Error(`falta_url_${b.sufijo ?? i}`);
      componentes.push({ type: "button", sub_type: "url", index: String(i), parameters: [{ type: "text", text: valor }] });
    }
  });
  const mensaje: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: para,
    type: "template",
    template: { name: def.nombre, language: { code: IDIOMA_PLANTILLAS }, components: componentes },
  };
  if (datosOpacos) mensaje.biz_opaque_callback_data = datosOpacos.slice(0, 512);
  return mensaje;
}

// ----------------------------------------------------------------------------
// Mensaje SIN plantilla (ventana de 24 h)
// ----------------------------------------------------------------------------
// Si Meta no deja usar la plantilla (aún sin aprobar, pausada…), el aviso se
// manda igual como mensaje normal: Meta lo admite dentro de las 24 h
// siguientes a que el cliente escriba al número, y lo rechaza fuera (error
// 131047), así que fuera de esa ventana no cambia nada. Mismo texto que la
// plantilla; las respuestas rápidas pasan a botones de respuesta (mismo
// payload firmado, ver leerWebhook: llegan como `interactive.button_reply`) y
// los botones de enlace, a líneas con la URL. Prueba de concepto: sirve para
// probar los botones mientras Meta revisa las plantillas.

/** Texto de la plantilla con sus variables puestas. */
export function rellenarCuerpo(def: DefinicionPlantilla, variables: string[]): string {
  return def.cuerpo.replace(/\{\{(\d+)\}\}/g, (_m, n) => variables[Number(n) - 1] ?? "");
}

/** URL final de un botón de enlace (con el final que se rellena al enviar). */
export function urlBoton(b: Extract<BotonPlantilla, { tipo: "url" }>, valores: ValoresBotones): string | null {
  if (!b.url.includes("{{1}}")) return b.url;
  const valor = b.sufijo === "gestionar" ? (valores.tokenGestion ? encodeURIComponent(valores.tokenGestion) : null) : valores.mapa;
  return valor ? b.url.replace("{{1}}", valor) : null;
}

/** Cuerpo de POST /{phone-number-id}/messages con el aviso SIN plantilla. */
export function mensajeSinPlantilla(opciones: {
  para: string;
  def: DefinicionPlantilla;
  variables: string[];
  botones?: ValoresBotones;
  datosOpacos?: string;
}): Record<string, unknown> {
  const { para, def, variables, botones = {}, datosOpacos } = opciones;
  const enlaces = def.botones
    .filter((b): b is Extract<BotonPlantilla, { tipo: "url" }> => b.tipo === "url")
    .map((b) => {
      const url = urlBoton(b, botones);
      return url ? `${b.texto}: ${url}` : null;
    })
    .filter((x): x is string => !!x);
  const texto = [rellenarCuerpo(def, variables), ...(enlaces.length ? [enlaces.join("\n")] : [])].join("\n\n");
  const respuestas = def.botones.filter((b): b is Extract<BotonPlantilla, { tipo: "respuesta" }> => b.tipo === "respuesta");

  const mensaje: Record<string, unknown> = respuestas.length
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: para,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: texto.slice(0, 1024) },
          action: {
            buttons: respuestas.slice(0, 3).map((b) => {
              const payload = botones.payloads?.[b.accion];
              if (!payload) throw new Error(`falta_payload_${b.accion}`);
              // Título de un botón de respuesta: máximo 20 caracteres.
              return { type: "reply", reply: { id: payload, title: b.texto.slice(0, 20) } };
            }),
          },
        },
      }
    : { messaging_product: "whatsapp", recipient_type: "individual", to: para, type: "text", text: { body: texto, preview_url: false } };
  if (datosOpacos) mensaje.biz_opaque_callback_data = datosOpacos.slice(0, 512);
  return mensaje;
}

/** Mensaje de texto libre (solo vale en las 24 h siguientes a que el cliente escriba o pulse un botón). */
export function mensajeTexto(para: string, texto: string, respondeA?: string): Record<string, unknown> {
  const mensaje: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: para,
    type: "text",
    text: { body: texto, preview_url: false },
  };
  if (respondeA) mensaje.context = { message_id: respondeA };
  return mensaje;
}

// ----------------------------------------------------------------------------
// Botones firmados (payload corto)
// ----------------------------------------------------------------------------
// Formato: r1.<id de la reserva>.<a|r>.<HHMM>.<caducidad en base 36>.<firma>
// La firma son los 16 primeros bytes del HMAC-SHA256 (base64url, 22
// caracteres) de "wa-boton|" + todo lo anterior, con EMAILS_RESERVA_TOKEN_SECRET.
// El prefijo "wa-boton|" separa estas firmas de las de los tokens del correo:
// una nunca vale por la otra. Unos 77 caracteres en total.

export type AccionBoton = "aceptar" | "rechazar";

const VERSION_PAYLOAD = "r1";
const DOMINIO_FIRMA = "wa-boton|";
const TTL_BOTON_SEGUNDOS = 60 * 60 * 24 * 14; // 14 días, igual que el enlace del correo

function base64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(secreto: string, datos: Uint8Array): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", clave, datos));
}

/** Compara dos cadenas sin cortar en la primera diferencia (no da pistas por el tiempo). */
export function compararTiempoConstante(a: string, b: string): boolean {
  const largo = Math.max(a.length, b.length);
  let diferencia = a.length ^ b.length;
  for (let i = 0; i < largo; i++) diferencia |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diferencia === 0;
}

async function firmaCorta(secreto: string, cuerpo: string): Promise<string> {
  const firma = await hmacSha256(secreto, new TextEncoder().encode(DOMINIO_FIRMA + cuerpo));
  return base64Url(firma.slice(0, 16));
}

export async function firmarPayloadBoton(
  secreto: string,
  reservaId: string,
  accion: AccionBoton,
  hora: string,
  ahoraEpochSegundos: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const hhmm = (hora || "").slice(0, 5).replace(":", "");
  const caduca = (ahoraEpochSegundos + TTL_BOTON_SEGUNDOS).toString(36);
  const cuerpo = [VERSION_PAYLOAD, reservaId, accion === "aceptar" ? "a" : "r", hhmm, caduca].join(".");
  return `${cuerpo}.${await firmaCorta(secreto, cuerpo)}`;
}

/** Devuelve los datos del botón, o `null` si la firma no vale, está caducado o el formato no es el nuestro. */
export async function leerPayloadBoton(
  secreto: string,
  payload: string,
  ahoraEpochSegundos: number = Math.floor(Date.now() / 1000),
): Promise<{ reservaId: string; accion: AccionBoton; hora: string } | null> {
  if (!secreto) return null;
  const partes = (payload || "").split(".");
  if (partes.length !== 6 || partes[0] !== VERSION_PAYLOAD) return null;
  const [, reservaId, a, hhmm, caduca, firma] = partes;
  if (!/^[0-9a-f-]{36}$/i.test(reservaId) || (a !== "a" && a !== "r") || !/^\d{4}$/.test(hhmm)) return null;
  const esperada = await firmaCorta(secreto, partes.slice(0, 5).join("."));
  if (!compararTiempoConstante(firma, esperada)) return null;
  const caducidad = parseInt(caduca, 36);
  if (!Number.isFinite(caducidad) || caducidad < ahoraEpochSegundos) return null;
  return { reservaId, accion: a === "a" ? "aceptar" : "rechazar", hora: `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` };
}

// ----------------------------------------------------------------------------
// Webhook de Meta
// ----------------------------------------------------------------------------

/** Firma de Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256 en hex del cuerpo CRUDO con la clave secreta de la app. */
export async function firmaMetaValida(cuerpoCrudo: Uint8Array, cabecera: string | null, secretoApp: string): Promise<boolean> {
  if (!secretoApp || !cabecera || !cabecera.startsWith("sha256=")) return false;
  const firma = await hmacSha256(secretoApp, cuerpoCrudo);
  const esperada = Array.from(firma, (b) => b.toString(16).padStart(2, "0")).join("");
  return compararTiempoConstante(cabecera.slice("sha256=".length).toLowerCase(), esperada);
}

export interface PulsacionBoton {
  /** Teléfono del cliente (wa_id). */
  de: string;
  mensajeId: string;
  payload: string;
  texto: string;
}

export interface EstadoEntrega {
  mensajeId: string;
  estado: string;
  destinatario: string;
  datosOpacos: string | null;
  errores: { codigo: number | null; titulo: string; detalle: string }[];
}

export interface MensajeLibre {
  de: string;
  mensajeId: string;
  tipo: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** Saca del aviso de Meta las pulsaciones de botones, los estados de entrega y los mensajes escritos a mano. */
export function leerWebhook(cuerpo: unknown): { pulsaciones: PulsacionBoton[]; estados: EstadoEntrega[]; libres: MensajeLibre[] } {
  const pulsaciones: PulsacionBoton[] = [];
  const estados: EstadoEntrega[] = [];
  const libres: MensajeLibre[] = [];
  if (obj(cuerpo).object !== "whatsapp_business_account") return { pulsaciones, estados, libres };

  for (const entrada of lista(obj(cuerpo).entry)) {
    for (const cambio of lista(obj(entrada).changes)) {
      if (obj(cambio).field !== "messages") continue;
      const valor = obj(obj(cambio).value);

      for (const m of lista(valor.messages)) {
        const mensaje = obj(m);
        const de = texto(mensaje.from);
        const mensajeId = texto(mensaje.id);
        if (!de || !mensajeId) continue;
        if (mensaje.type === "button") {
          // Botón de respuesta rápida de una plantilla.
          const boton = obj(mensaje.button);
          pulsaciones.push({ de, mensajeId, payload: texto(boton.payload), texto: texto(boton.text) });
        } else if (mensaje.type === "interactive" && obj(mensaje.interactive).type === "button_reply") {
          // Botón de un mensaje interactivo (dentro de las 24 h): mismo payload en `id`.
          const boton = obj(obj(mensaje.interactive).button_reply);
          pulsaciones.push({ de, mensajeId, payload: texto(boton.id), texto: texto(boton.title) });
        } else {
          libres.push({ de, mensajeId, tipo: texto(mensaje.type) || "desconocido" });
        }
      }

      for (const s of lista(valor.statuses)) {
        const estado = obj(s);
        estados.push({
          mensajeId: texto(estado.id),
          estado: texto(estado.status),
          destinatario: texto(estado.recipient_id),
          datosOpacos: texto(estado.biz_opaque_callback_data) || null,
          errores: lista(estado.errors).map((e) => {
            const error = obj(e);
            return {
              codigo: typeof error.code === "number" ? error.code : null,
              titulo: texto(error.title),
              detalle: texto(obj(error.error_data).details) || texto(error.message),
            };
          }),
        });
      }
    }
  }
  return { pulsaciones, estados, libres };
}

/** Lo que se guarda en `biz_opaque_callback_data` para saber de qué reserva es un estado de entrega. */
export function datosOpacos(reservaId: string, tipo: TipoAvisoWhatsApp): string {
  return JSON.stringify({ r: reservaId, t: tipo });
}

export function leerDatosOpacos(valor: string | null): { reservaId: string; tipo: TipoAvisoWhatsApp } | null {
  try {
    const d = obj(JSON.parse(valor ?? ""));
    if (typeof d.r === "string" && esTipoAvisoWhatsApp(d.t)) return { reservaId: d.r, tipo: d.t };
  } catch {
    // no es nuestro
  }
  return null;
}

// ----------------------------------------------------------------------------
// Respuesta en el chat tras pulsar un botón
// ----------------------------------------------------------------------------

/** Lo que usamos de la respuesta de emails-reserva POST /enlace/ejecutar (RespuestaEnlace en enlaces-web.ts). */
export interface RespuestaEjecutar {
  estado?: string;
  negocio?: { nombre?: string; telefonoTexto?: string } | null;
  detalles?: { nombre?: string; fecha?: string; hora?: string; comensales?: number } | null;
}

export function textoRespuestaBoton(respuesta: RespuestaEjecutar | null, accion: AccionBoton | null): string {
  const negocioPorDefecto = negocioDeMarca(null);
  const negocio = respuesta?.negocio?.nombre || negocioPorDefecto.nombre;
  const telefono = respuesta?.negocio?.telefonoTexto || negocioPorDefecto.telefonoTexto;
  const d = respuesta?.detalles ?? null;
  const nombre = d?.nombre ? limpiarVariable(d.nombre.split(" ")[0], "", 30) : "";
  const fecha = d?.fecha ? fechaParaMensaje(d.fecha) : "";
  const hora = d?.hora ? d.hora.slice(0, 5) : "";
  const cuando = fecha && hora ? `el ${fecha} a las ${hora} h` : "";

  switch (respuesta?.estado) {
    case "hecho":
      if (accion === "aceptar") {
        const personas = d?.comensales ? `, ${d.comensales} ${d.comensales === 1 ? "persona" : "personas"}` : "";
        return `¡Perfecto${nombre ? `, ${nombre}` : ""}! Tu reserva en ${negocio} queda confirmada${cuando ? ` ${cuando}${personas}` : ""}. ¡Te esperamos!`;
      }
      return `Entendido, hemos cancelado tu reserva${cuando ? ` del ${fecha}` : ""}. Si quieres buscar otro día u hora, llámanos al ${telefono}. ¡Gracias por avisar!`;
    case "ya_hecho":
      return accion === "aceptar"
        ? `Tu reserva ya estaba confirmada${cuando ? `: te esperamos ${cuando}` : ""}. ¡Hasta pronto!`
        : `Tu reserva ya estaba cancelada. Si quieres hacer otra, llámanos al ${telefono}.`;
    case "recibida":
      return "Hemos recibido tu respuesta. Te confirmaremos la reserva en cuanto la revisemos.";
    case "sin_aforo":
      return `Lo sentimos, ya no nos queda sitio a esa hora. Llámanos al ${telefono} y te buscamos otra.`;
    case "fecha_pasada":
      return `Esta reserva ya ha pasado. Si quieres hacer otra, llámanos al ${telefono}.`;
    case "invalido":
      return `Este botón ya no sirve: la reserva ha cambiado o ha caducado. Si tienes dudas, llámanos al ${telefono}.`;
    default:
      return `No hemos podido registrar tu respuesta. Por favor, llámanos al ${telefono}.`;
  }
}

/** Respuesta a quien escribe a mano: este número no lo atiende nadie. */
export function textoMensajeLibre(): string {
  const n = negocioDeMarca(null);
  return `Este número solo envía avisos de reservas y no lee los mensajes. Para cualquier cosa, llámanos al ${n.telefonoTexto}. ¡Gracias!`;
}
