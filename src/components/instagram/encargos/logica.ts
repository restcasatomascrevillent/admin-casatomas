/**
 * Lógica pura de los encargos de Instagram (sin React ni Supabase): estados,
 * columnas del tablero, qué puede hacer cada lado en cada estado, contador de
 * pendientes, rutas de las entregas y huecos del calendario. La regla de
 * verdad está en la base de datos (RPC instagram_encargo_*, migración
 * 20261110100000); aquí solo se decide qué botones enseñar.
 * Ver docs/instagram-encargos.md.
 */
import type { MarcaId } from "@/lib/instagram";
import { ESTADOS_ENCARGO, ESTILO_TONO } from "../estados";

export type EstadoEncargo =
  | "borrador"
  | "enviado"
  | "aceptado"
  | "en_curso"
  | "para_revisar"
  | "cambios_pedidos"
  | "aprobado"
  | "publicado"
  | "rechazado"
  | "cancelado";

export type ModoEncargo = "automatico" | "oficiosos";
export type FormatoEncargo = "post" | "story" | "reel";
export type Lado = "restaurante" | "agencia";

export interface FotoEncargo {
  id: string;
  nombre?: string | null;
  miniatura?: string | null;
}

export interface Encargo {
  id: string;
  numero: number;
  marca: MarcaId;
  modo: ModoEncargo;
  formato: FormatoEncargo;
  titulo: string;
  idea: string | null;
  estilo: string | null;
  plantilla: string | null;
  base_reel: string | null;
  texto: string | null;
  fecha_deseada: string | null;
  fecha_entrega_prevista: string | null;
  fecha_entrega: string | null;
  estado: EstadoEncargo;
  rondas_cambios: number;
  rondas_incluidas: number;
  motivo: string | null;
  pieza_id: string | null;
  creado_por: string | null;
  asignado_a: string | null;
  enviado_at: string | null;
  entregado_at: string | null;
  aprobado_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdjuntoEncargo {
  id: string;
  encargo_id: string;
  foto_id: string;
  nombre: string | null;
  miniatura: string | null;
  orden: number;
}

export interface EntregaEncargo {
  id: string;
  encargo_id: string;
  version: number;
  tipo_medio: "imagen" | "reel";
  cubo: "instagram" | "instagram-video" | null;
  ruta: string | null;
  portada_ruta: string | null;
  pieza_id: string | null;
  bytes: number | null;
  ancho: number | null;
  alto: number | null;
  duracion_s: number | null;
  texto: string | null;
  nota: string | null;
  created_at: string;
}

export interface MensajeEncargo {
  id: string;
  encargo_id: string;
  autor: string | null;
  lado: Lado;
  texto: string;
  created_at: string;
}

export interface EventoEncargo {
  id: string;
  encargo_id: string;
  actor: string | null;
  lado: Lado | "sistema";
  accion: string;
  de_estado: string | null;
  a_estado: string | null;
  comentario: string | null;
  created_at: string;
}

export interface AjustesEncargos {
  plazo_dias_laborables: number;
  rondas_incluidas: number;
  cupo_mensual: number | null;
}

export const AJUSTES_POR_DEFECTO: AjustesEncargos = { plazo_dias_laborables: 5, rondas_incluidas: 2, cupo_mensual: null };

export const NOMBRE_ESTADO: Record<EstadoEncargo, string> = {
  borrador: "Borrador",
  enviado: "Enviado",
  aceptado: "Aceptado",
  en_curso: "En curso",
  para_revisar: "Para revisar",
  cambios_pedidos: "Cambios pedidos",
  aprobado: "Aprobado",
  publicado: "Publicado",
  rechazado: "Rechazado",
  cancelado: "Cancelado",
};

/** Clases de la insignia de cada estado: las del módulo único de estados (../estados.ts, paleta de la maqueta). */
export const CLASE_ESTADO = Object.fromEntries(
  (Object.keys(ESTADOS_ENCARGO) as EstadoEncargo[]).map((e) => [e, `border ${ESTILO_TONO[ESTADOS_ENCARGO[e].tono].insignia}`]),
) as Record<EstadoEncargo, string>;

/** Estilos que se ofrecen a Oficiosos (texto libre en la BD). */
export const ESTILOS_OFICIOSOS = [
  "Reel con rótulos (como «Del mar»)",
  "Foto y titular",
  "Lema en gallego",
  "Touza · Cóctel de autor",
  "Lo que proponga Oficiosos",
] as const;

export const NOMBRE_FORMATO: Record<FormatoEncargo, string> = { post: "Post", story: "Story", reel: "Vídeo (reel)" };
export const NOMBRE_MODO: Record<ModoEncargo, string> = { automatico: "Automático", oficiosos: "Oficiosos" };
export const NOMBRE_MARCA: Record<MarcaId, string> = { "casa-tomas": "Casa Tomás", touza: "Touza" };

export interface Columna {
  id: "pedido" | "curso" | "revisar" | "aprobado" | "publicado" | "cerrados";
  nombre: string;
  estados: EstadoEncargo[];
  /** Color del punto de la cabecera. */
  color: string;
}

/** Columnas del tablero (maqueta: Pedido, En curso, Para revisar, Aprobado, Publicado). */
export const COLUMNAS: readonly Columna[] = [
  { id: "pedido", nombre: "Pedido", estados: ["borrador", "enviado", "aceptado", "rechazado"], color: ESTILO_TONO.borrador.punto },
  { id: "curso", nombre: "En curso", estados: ["en_curso", "cambios_pedidos"], color: ESTILO_TONO.encargo.punto },
  { id: "revisar", nombre: "Para revisar", estados: ["para_revisar"], color: ESTILO_TONO.revisar.punto },
  { id: "aprobado", nombre: "Aprobado", estados: ["aprobado"], color: ESTILO_TONO.programada.punto },
  { id: "publicado", nombre: "Publicado", estados: ["publicado"], color: ESTILO_TONO.publicada.punto },
];
export const COLUMNA_CERRADOS: Columna = { id: "cerrados", nombre: "Cancelados", estados: ["cancelado"], color: "bg-muted-foreground" };

/** Pasos que se pintan en la ficha. */
export const PASOS = ["Pedido", "En curso", "Para revisar", "Aprobado", "Publicado"] as const;
export function pasoDeEstado(estado: EstadoEncargo): number {
  const i = COLUMNAS.findIndex((c) => c.estados.includes(estado));
  return i < 0 ? -1 : i;
}

/** «ENC-0007». */
export function referencia(numero: number | null | undefined): string {
  return typeof numero === "number" && Number.isFinite(numero) ? `ENC-${String(numero).padStart(4, "0")}` : "ENC";
}

export interface Roles {
  restaurante: boolean;
  agencia: boolean;
}

/** Lo que espera a cada lado: lo que cuenta en el número de la pestaña. */
export function esperaA(e: Pick<Encargo, "estado" | "modo">): Lado | null {
  if (e.estado === "para_revisar" || e.estado === "rechazado") return "restaurante";
  if (e.modo === "oficiosos" && (e.estado === "enviado" || e.estado === "cambios_pedidos")) return "agencia";
  return null;
}

export function pendientes(encargos: readonly Pick<Encargo, "estado" | "modo">[], roles: Roles): number {
  return encargos.filter((e) => {
    const lado = esperaA(e);
    return (lado === "restaurante" && roles.restaurante) || (lado === "agencia" && roles.agencia);
  }).length;
}

export type Accion =
  | "editar"
  | "enviar"
  | "generar"
  | "aprobar"
  | "pedir_cambios"
  | "cancelar"
  | "aceptar"
  | "rechazar"
  | "empezar"
  | "entregar"
  | "programar"
  | "comentar";

/** Botones de la ficha según el estado y quién mira (la BD vuelve a comprobarlo). */
export function accionesDisponibles(e: Pick<Encargo, "estado" | "modo" | "pieza_id">, roles: Roles): Accion[] {
  const a: Accion[] = [];
  const oficiosos = e.modo === "oficiosos";
  if (roles.restaurante) {
    if (e.estado === "borrador" || e.estado === "rechazado") a.push("editar", "enviar");
    if (!oficiosos && e.estado === "en_curso" && !e.pieza_id) a.push("generar");
    if (e.estado === "para_revisar") {
      a.push("aprobar");
      if (oficiosos) a.push("pedir_cambios");
    }
    if (e.estado === "aprobado" && e.pieza_id) a.push("programar");
    if (["borrador", "enviado", "aceptado", "en_curso", "para_revisar", "cambios_pedidos", "rechazado"].includes(e.estado)) a.push("cancelar");
  }
  if (roles.agencia && oficiosos) {
    if (e.estado === "enviado") a.push("aceptar", "rechazar");
    if (e.estado === "aceptado") a.push("empezar", "entregar", "rechazar");
    if (e.estado === "cambios_pedidos") a.push("empezar", "entregar");
    if (e.estado === "en_curso") a.push("entregar");
  }
  if (e.estado !== "borrador" && (roles.restaurante || (roles.agencia && oficiosos))) a.push("comentar");
  return [...new Set(a)];
}

/** «Ronda 1 de 2 incluidas» / «Ronda 3 · fuera de las 2 incluidas». */
export function textoRonda(siguiente: number, incluidas: number): string {
  return siguiente > incluidas ? `Ronda ${siguiente} · fuera de las ${incluidas} incluidas (puede tener coste)` : `Ronda ${siguiente} de ${incluidas} incluidas`;
}

/** Ocho caracteres hexadecimales aleatorios (sufijo de las rutas de entrega). */
export function sufijoAleatorio(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Dónde se sube una entrega (lo exige instagram_encargo_entregar):
 *   imagen → cubo «instagram»       encargos/<encargo>/v<N>-<8 hex>.jpg
 *   reel   → cubo «instagram-video» reels/AAAA-MM/<encargo>-<8 hex>.mp4 (portada .jpg)
 */
export function rutasEntrega(
  e: Pick<Encargo, "id" | "formato">,
  version: number,
  ahora = new Date(),
  sufijo = sufijoAleatorio(),
): { cubo: "instagram" | "instagram-video"; ruta: string; portada: string | null } {
  if (e.formato === "reel") {
    const mes = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, "0")}`;
    const base = `reels/${mes}/${e.id}-${sufijo}`;
    return { cubo: "instagram-video", ruta: `${base}.mp4`, portada: `${base}.jpg` };
  }
  return { cubo: "instagram", ruta: `encargos/${e.id}/v${version}-${sufijo}.jpg`, portada: null };
}

/** ¿Vale este fichero como entrega? null si sí; si no, el motivo. */
export function problemaFicheroEntrega(f: Pick<File, "type" | "size" | "name">, formato: FormatoEncargo): string | null {
  if (formato === "reel") {
    if (f.type !== "video/mp4" && !/\.mp4$/i.test(f.name)) return "El vídeo tiene que ser un MP4.";
    if (f.size > 50 * 1024 * 1024) return "El vídeo pasa de 50 MB.";
    return null;
  }
  if (f.type !== "image/jpeg" && !/\.jpe?g$/i.test(f.name)) return "La imagen tiene que ser un JPEG (Instagram solo publica JPEG).";
  if (f.size > 8 * 1024 * 1024) return "La imagen pasa de 8 MB.";
  return null;
}

/** Aviso (no bloquea) si las medidas no encajan con el formato de Instagram. */
export function avisoMedidas(formato: FormatoEncargo, ancho?: number | null, alto?: number | null): string | null {
  if (!ancho || !alto) return null;
  const r = ancho / alto;
  if (formato === "post" && (r < 0.79 || r > 1.92)) return `Mide ${ancho}×${alto}: un post tiene que ir entre 4:5 y 1,91:1 (lo normal, 1080×1350).`;
  if ((formato === "story" || formato === "reel") && Math.abs(r - 9 / 16) > 0.02) return `Mide ${ancho}×${alto}: lo normal es 9:16 (1080×1920).`;
  return null;
}

/** Estados en los que el encargo reserva su hueco en el calendario. */
export const ESTADOS_HUECO: readonly EstadoEncargo[] = ["enviado", "aceptado", "en_curso", "para_revisar", "cambios_pedidos", "aprobado"];

export interface HuecoEncargo {
  id: string;
  numero: number;
  marca: MarcaId;
  titulo: string;
  formato: FormatoEncargo;
  estado: EstadoEncargo;
  dia: string;
  /** La fecha ya ha pasado y aún no está aprobado. */
  retrasado: boolean;
}

/** Huecos por día (AAAA-MM-DD) a partir de los encargos vivos con fecha deseada. */
export function huecosPorDia(encargos: readonly Pick<Encargo, "id" | "numero" | "marca" | "titulo" | "formato" | "estado" | "fecha_deseada">[], hoy: string): Map<string, HuecoEncargo[]> {
  const mapa = new Map<string, HuecoEncargo[]>();
  for (const e of encargos) {
    if (!e.fecha_deseada || !ESTADOS_HUECO.includes(e.estado)) continue;
    const dia = e.fecha_deseada.slice(0, 10);
    const h: HuecoEncargo = {
      id: e.id,
      numero: e.numero,
      marca: e.marca,
      titulo: e.titulo,
      formato: e.formato,
      estado: e.estado,
      dia,
      retrasado: dia < hoy && e.estado !== "aprobado",
    };
    mapa.set(dia, [...(mapa.get(dia) ?? []), h]);
  }
  return mapa;
}

/** Fecha corta en castellano: «13 nov». */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "sin fecha";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return iso;
  return `${d} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][m - 1]}`;
}

/** Fecha de hoy + n días laborables (lunes a viernes), igual que instagram_sumar_dias_laborables. */
export function sumarDiasLaborables(desde: string, dias: number): string {
  const d = new Date(`${desde.slice(0, 10)}T12:00:00Z`);
  let n = 0;
  while (n < Math.max(0, dias)) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return d.toISOString().slice(0, 10);
}

/** Hoy en Madrid (AAAA-MM-DD). */
export function hoyMadrid(ahora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

export interface DatosFormulario {
  marca: MarcaId;
  modo: ModoEncargo;
  formato: FormatoEncargo;
  titulo: string;
  idea: string;
  estilo: string;
  plantilla: string;
  base_reel: string;
  texto: string;
  fecha_deseada: string;
  fotos: FotoEncargo[];
}

export function formularioVacio(marca: MarcaId = "casa-tomas"): DatosFormulario {
  return { marca, modo: "oficiosos", formato: "reel", titulo: "", idea: "", estilo: "", plantilla: "", base_reel: "del-mar", texto: "", fecha_deseada: "", fotos: [] };
}

export function formularioDesdeEncargo(e: Encargo, adjuntos: readonly AdjuntoEncargo[]): DatosFormulario {
  return {
    marca: e.marca,
    modo: e.modo,
    formato: e.formato,
    titulo: e.titulo,
    idea: e.idea ?? "",
    estilo: e.estilo ?? "",
    plantilla: e.plantilla ?? "",
    base_reel: e.base_reel ?? "del-mar",
    texto: e.texto ?? "",
    fecha_deseada: e.fecha_deseada ?? "",
    fotos: [...adjuntos].sort((a, b) => a.orden - b.orden).map((a) => ({ id: a.foto_id, nombre: a.nombre, miniatura: a.miniatura })),
  };
}

/** Lo que falta para enviar (mismas reglas que instagram_encargo_enviar). */
export function problemasFormulario(d: DatosFormulario, hoy: string): string[] {
  const p: string[] = [];
  if (!d.titulo.trim()) p.push("Ponle un título.");
  if (d.titulo.trim().length > 120) p.push("El título pasa de 120 caracteres.");
  if (!d.fecha_deseada) p.push("Indica para cuándo lo quieres.");
  else if (d.fecha_deseada < hoy) p.push("La fecha deseada ya ha pasado.");
  if (d.modo === "oficiosos" && !d.idea.trim()) p.push("Cuenta la idea a Oficiosos.");
  if (d.modo === "automatico" && d.formato === "reel" && !d.base_reel) p.push("Elige el reel base.");
  if (d.modo === "automatico" && d.formato !== "reel" && !d.plantilla) p.push("Elige la plantilla.");
  if (d.texto.length > 2200) p.push("El texto pasa de 2200 caracteres.");
  if (d.fotos.length > 20) p.push("Como mucho 20 fotos.");
  return p;
}

/** Datos para la RPC instagram_encargo_guardar. */
export function datosParaGuardar(d: DatosFormulario): Record<string, unknown> {
  return {
    marca: d.marca,
    modo: d.modo,
    formato: d.formato,
    titulo: d.titulo.trim(),
    idea: d.idea.trim(),
    estilo: d.estilo.trim(),
    plantilla: d.modo === "automatico" && d.formato !== "reel" ? d.plantilla : "",
    base_reel: d.formato === "reel" ? d.base_reel : "",
    texto: d.texto,
    fecha_deseada: d.fecha_deseada,
    fotos: d.fotos.map((f) => ({ id: f.id, nombre: f.nombre ?? "", ...(f.miniatura && /^https:\/\//.test(f.miniatura) ? { miniatura: f.miniatura } : {}) })),
  };
}

/** Texto legible de un evento del historial (se mezcla con los mensajes en el hilo). */
export function textoEvento(ev: Pick<EventoEncargo, "accion" | "comentario">): string {
  const base: Record<string, string> = {
    enviar: "Encargo enviado",
    reenviar: "Encargo reenviado",
    aceptar: "Aceptado",
    rechazar: "Rechazado",
    empezar: "En curso",
    entregar: "Nueva versión entregada",
    generado: "Pieza generada",
    generando: "Generando la pieza",
    pedir_cambios: "Cambios pedidos",
    aprobar: "Aprobado",
    cancelar: "Cancelado",
    publicar: "Publicado en Instagram",
  };
  const t = base[ev.accion] ?? ev.accion;
  return ev.comentario && ev.accion !== "comentar" ? `${t}: ${ev.comentario}` : t;
}
