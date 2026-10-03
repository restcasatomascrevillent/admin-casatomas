// ============================================================================
// SINCRONIZACIÓN newsletter_suscriptores -> Resend Marketing (lógica pura)
// ----------------------------------------------------------------------------
// La tabla manda; Resend es el cartero. Cada pasada:
//
//   1. Lee la foto de Resend: todos los contactos de la cuenta (lo que cuenta
//      para el límite de 1.000) y los del Segment del newsletter.
//   2. Lee la tabla (y direcciones_email_suprimidas).
//   3. PLANIFICA solo las diferencias (`planificarSync`, puro): por eso es
//      incremental — una pasada sin cambios no escribe nada en Resend.
//   4. EJECUTA en este orden, a ≤ 8 peticiones/s:
//      a) RECONCILIACIÓN: activo en la tabla pero `unsubscribed = true` en
//         Resend = se dio de baja en la página de Resend y el webhook
//         contact.updated se perdió -> baja en la tabla ('resend_baja_nativa',
//         vía newsletter_registrar_baja) y, después, se borra el contacto.
//         NUNCA al revés: nada de aquí pone unsubscribed:false en Resend ni
//         activo = true en la tabla.
//      b) BORRAR de Resend a los dados de baja (y a los activos cuya dirección
//         está suprimida): libera cuota y garantiza que no reciben el
//         siguiente Broadcast.
//      c) QUITAR del Segment a contactos que no son de la tabla (alguien los
//         metió a mano en el dashboard): solo reciben los de la tabla.
//      d) ALTAS (contacto nuevo ya dentro del Segment), AÑADIR al Segment a
//         los que ya existían, y ACTUALIZAR el nombre si cambió.
//   5. Marca en la tabla resend_contact_id / resend_sincronizado_at de las
//      filas que han cambiado (no de todas: updated_at no se ensucia a diario).
//
// `bloqueaEnvio`: si queda pendiente o falla algo de a), b) o c), enviar un
// Broadcast podría llegar a quien no debe -> enviar-newsletter se niega.
// Un alta fallida NO bloquea (ese suscriptor simplemente no lo recibe).
// ============================================================================

import { normalizarEmail, nombreParaResend } from "./config.ts";
import type { ContactoResend, ResultadoResend, SegmentoResend } from "./cliente.ts";

export interface SuscriptorLocal {
  id: string;
  email: string;
  nombre: string | null;
  activo: boolean;
  resend_contact_id: string | null;
}

export interface EntradaPlan {
  locales: SuscriptorLocal[];
  suprimidas: Set<string>;
  contactos: ContactoResend[];
  enSegmento: ContactoResend[];
}

export interface Plan {
  bajasNativas: { email: string; suscriptorIds: string[]; contactId: string }[];
  borrar: { contactId: string; suscriptorIds: string[]; motivo: "baja" | "suprimida" }[];
  quitarDeSegmento: { contactId: string }[];
  crear: { suscriptorIds: string[]; email: string; nombre: string | null }[];
  anadirASegmento: { contactId: string; suscriptorIds: string[] }[];
  actualizarNombre: { contactId: string; suscriptorIds: string[]; nombre: string }[];
  /** Cambios solo en la tabla (vincular un contacto que ya existía, o desvincular uno que ya no está). */
  vincular: { suscriptorId: string; contactId: string | null }[];
  /** Activos con contacto suscrito que ya están en el Segment y no necesitan nada. */
  yaCuadrados: number;
  ajenos: number;
  contactosResend: number;
  contactosSegmento: number;
}

interface Grupo {
  email: string;
  ids: string[];
  filas: SuscriptorLocal[];
  activo: boolean;
  nombre: string | null;
}

function agrupar(locales: SuscriptorLocal[]): Map<string, Grupo> {
  const grupos = new Map<string, Grupo>();
  for (const s of locales) {
    const email = normalizarEmail(s.email);
    if (!email) continue;
    let g = grupos.get(email);
    if (!g) {
      g = { email, ids: [], filas: [], activo: false, nombre: null };
      grupos.set(email, g);
    }
    g.ids.push(s.id);
    g.filas.push(s);
    if (s.activo) {
      g.activo = true;
      if (!g.nombre) g.nombre = nombreParaResend(s.nombre);
    }
  }
  return grupos;
}

/** Diferencias entre la tabla y Resend. Puro: no hace I/O. */
export function planificarSync(e: EntradaPlan): Plan {
  const plan: Plan = {
    bajasNativas: [],
    borrar: [],
    quitarDeSegmento: [],
    crear: [],
    anadirASegmento: [],
    actualizarNombre: [],
    vincular: [],
    yaCuadrados: 0,
    ajenos: 0,
    contactosResend: e.contactos.length,
    contactosSegmento: e.enSegmento.length,
  };

  const porEmail = new Map<string, ContactoResend>();
  for (const c of e.contactos) {
    const k = normalizarEmail(c.email);
    if (k && !porEmail.has(k)) porEmail.set(k, c);
  }
  const idsSegmento = new Set(e.enSegmento.map((c) => c.id));
  const grupos = agrupar(e.locales);

  for (const g of grupos.values()) {
    const c = porEmail.get(g.email);
    const suprimida = e.suprimidas.has(g.email);

    if (g.activo && !suprimida) {
      if (!c) {
        plan.crear.push({ suscriptorIds: g.ids, email: g.email, nombre: g.nombre });
        continue;
      }
      if (c.unsubscribed) {
        plan.bajasNativas.push({ email: g.email, suscriptorIds: g.ids, contactId: c.id });
        continue;
      }
      let accion = false;
      if (!idsSegmento.has(c.id)) {
        plan.anadirASegmento.push({ contactId: c.id, suscriptorIds: g.ids });
        accion = true;
      }
      if (g.nombre && g.nombre !== (c.first_name ?? null)) {
        plan.actualizarNombre.push({ contactId: c.id, suscriptorIds: g.ids, nombre: g.nombre });
        accion = true;
      }
      for (const f of g.filas) {
        if (f.resend_contact_id !== c.id) plan.vincular.push({ suscriptorId: f.id, contactId: c.id });
      }
      if (!accion) plan.yaCuadrados++;
      continue;
    }

    // Dado de baja (o dirección suprimida): fuera de Resend.
    if (c) {
      plan.borrar.push({ contactId: c.id, suscriptorIds: g.ids, motivo: g.activo ? "suprimida" : "baja" });
    } else {
      for (const f of g.filas) {
        if (f.resend_contact_id) plan.vincular.push({ suscriptorId: f.id, contactId: null });
      }
    }
  }

  for (const c of e.contactos) {
    if (!grupos.has(normalizarEmail(c.email))) {
      plan.ajenos++;
      if (idsSegmento.has(c.id)) plan.quitarDeSegmento.push({ contactId: c.id });
    }
  }
  // Miembros del Segment que no salen en la lista global (no debería pasar): también fuera si no son de la tabla.
  const idsGlobales = new Set(e.contactos.map((c) => c.id));
  for (const c of e.enSegmento) {
    if (!idsGlobales.has(c.id) && !grupos.has(normalizarEmail(c.email))) plan.quitarDeSegmento.push({ contactId: c.id });
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

/** Lo que la sincronización necesita del cliente de Resend (ClienteResendMarketing lo cumple). */
export interface ClienteSync {
  listarContactos(): Promise<ResultadoResend<ContactoResend[]>>;
  listarContactosSegmento(segmentId: string): Promise<ResultadoResend<ContactoResend[]>>;
  listarSegmentos(): Promise<ResultadoResend<SegmentoResend[]>>;
  crearSegmento(nombre: string): Promise<ResultadoResend<{ id: string }>>;
  obtenerContacto(idOEmail: string): Promise<ResultadoResend<ContactoResend>>;
  crearContacto(email: string, nombre: string | null, segmentId: string): Promise<ResultadoResend<{ id: string }>>;
  actualizarNombre(contactId: string, nombre: string): Promise<ResultadoResend<unknown>>;
  borrarContacto(idOEmail: string): Promise<ResultadoResend<unknown>>;
  anadirASegmento(contactId: string, segmentId: string): Promise<ResultadoResend<unknown>>;
  quitarDeSegmento(contactId: string, segmentId: string): Promise<ResultadoResend<unknown>>;
  peticiones?: number;
}

/** Lo que la sincronización necesita de la base de datos. */
export interface DatosSync {
  leerSuscriptores(): Promise<SuscriptorLocal[]>;
  leerSuprimidas(): Promise<Set<string>>;
  /** newsletter_registrar_baja(email, 'resend_baja_nativa'): filas dadas de baja. */
  registrarBajaNativa(email: string): Promise<number>;
  /** newsletter_marcar_sincronizados. */
  marcarSincronizados(items: { id: string; contact_id: string | null }[]): Promise<void>;
}

export interface ErrorSync {
  suscriptorId: string | null;
  accion: string;
  mensaje: string;
}

export type EstadoSync = "ok" | "parcial" | "error";

export interface ResumenSync {
  estado: EstadoSync;
  segmentId: string | null;
  segmentoCreado: boolean;
  /** Contactos en la cuenta de Resend al terminar (lo que cuenta para el límite). */
  contactosResend: number | null;
  /** Contactos en el Segment al terminar. */
  contactosSegmento: number | null;
  ajenos: number | null;
  /** Activos de la tabla que recibirían un Broadcast ahora mismo. */
  destinatarios: number | null;
  altas: number;
  actualizados: number;
  anadidosSegmento: number;
  quitadosSegmento: number;
  borrados: number;
  bajasResend: number;
  errores: ErrorSync[];
  pendientes: number;
  bloqueaEnvio: boolean;
  peticiones: number;
  mensajeError: string | null;
}

export interface OpcionesSync {
  cliente: ClienteSync;
  datos: DatosSync;
  /** RESEND_NEWSLETTER_SEGMENT_ID si está configurado; si no, se busca por nombre (y se crea si no existe). */
  segmentIdConfigurado?: string | null;
  nombreSegmento: string;
  /** Hora límite (ms epoch) para empezar acciones nuevas en Resend; lo que no quepa queda pendiente para la siguiente pasada. */
  hastaMs?: number;
  ahora?: () => number;
  log?: (msg: string) => void;
}

const TAM_LOTE_MARCAR = 50;

function resumenVacio(): ResumenSync {
  return {
    estado: "ok",
    segmentId: null,
    segmentoCreado: false,
    contactosResend: null,
    contactosSegmento: null,
    ajenos: null,
    destinatarios: null,
    altas: 0,
    actualizados: 0,
    anadidosSegmento: 0,
    quitadosSegmento: 0,
    borrados: 0,
    bajasResend: 0,
    errores: [],
    pendientes: 0,
    bloqueaEnvio: false,
    peticiones: 0,
    mensajeError: null,
  };
}

/** Busca el Segment por nombre y, si no existe, lo crea. */
export async function resolverSegmento(
  cliente: Pick<ClienteSync, "listarSegmentos" | "crearSegmento">,
  configurado: string | null | undefined,
  nombre: string,
): Promise<{ ok: true; id: string; creado: boolean } | { ok: false; mensaje: string }> {
  const id = (configurado ?? "").trim();
  if (id) return { ok: true, id, creado: false };
  const lista = await cliente.listarSegmentos();
  if (!lista.ok) return { ok: false, mensaje: `No se pudieron listar los Segments de Resend: ${lista.mensaje}` };
  const objetivo = nombre.trim().toLowerCase();
  const existente = lista.data.find((s) => (s.name ?? "").trim().toLowerCase() === objetivo);
  if (existente) return { ok: true, id: existente.id, creado: false };
  const creado = await cliente.crearSegmento(nombre);
  if (!creado.ok || !creado.data?.id) {
    return { ok: false, mensaje: `No se pudo crear el Segment "${nombre}" en Resend: ${creado.ok ? "respuesta sin id" : creado.mensaje}` };
  }
  return { ok: true, id: creado.data.id, creado: true };
}

/** "Ya está en el Segment" no es un error. */
function yaEstaba(r: { ok: boolean; status: number; mensaje?: string }): boolean {
  return !r.ok && (r.status === 409 || r.status === 422) && /already|ya existe|exists/i.test(r.mensaje ?? "");
}

export async function sincronizar(op: OpcionesSync): Promise<ResumenSync> {
  const ahora = op.ahora ?? (() => Date.now());
  const log = op.log ?? ((m: string) => console.log(m));
  const r = resumenVacio();
  const fallar = (mensaje: string): ResumenSync => {
    r.estado = "error";
    r.bloqueaEnvio = true;
    r.mensajeError = mensaje;
    r.peticiones = op.cliente.peticiones ?? 0;
    return r;
  };

  // 1. Segment
  const seg = await resolverSegmento(op.cliente, op.segmentIdConfigurado, op.nombreSegmento);
  if (!seg.ok) return fallar(seg.mensaje);
  r.segmentId = seg.id;
  r.segmentoCreado = seg.creado;
  if (seg.creado) log(`[newsletter-sync] Segment "${op.nombreSegmento}" creado en Resend: ${seg.id} (guárdalo en RESEND_NEWSLETTER_SEGMENT_ID)`);

  // 2. Foto de Resend
  const contactos = await op.cliente.listarContactos();
  if (!contactos.ok) return fallar(`No se pudieron listar los contactos de Resend (${contactos.status} ${contactos.tipo}): ${contactos.mensaje}`);
  const enSegmento = seg.creado ? { ok: true as const, status: 200, data: [] as ContactoResend[] } : await op.cliente.listarContactosSegmento(seg.id);
  if (!enSegmento.ok) return fallar(`No se pudieron listar los contactos del Segment ${seg.id} (${enSegmento.status} ${enSegmento.tipo}): ${enSegmento.mensaje}`);

  // 3. Tabla
  let locales: SuscriptorLocal[];
  let suprimidas: Set<string>;
  try {
    locales = await op.datos.leerSuscriptores();
    suprimidas = await op.datos.leerSuprimidas();
  } catch (e) {
    return fallar(`No se pudo leer newsletter_suscriptores: ${e instanceof Error ? e.message : String(e)}`);
  }

  const plan = planificarSync({ locales, suprimidas, contactos: contactos.data, enSegmento: enSegmento.data });

  // 4. Ejecutar
  const segmentId = seg.id;
  const marcas: { id: string; contact_id: string | null }[] = [...plan.vincular.map((v) => ({ id: v.suscriptorId, contact_id: v.contactId }))];
  const marcar = (ids: string[], contactId: string | null) => {
    for (const id of ids) marcas.push({ id, contact_id: contactId });
  };
  const volcarMarcas = async (todo = false) => {
    while (marcas.length >= (todo ? 1 : TAM_LOTE_MARCAR)) {
      const lote = marcas.splice(0, TAM_LOTE_MARCAR);
      try {
        await op.datos.marcarSincronizados(lote);
      } catch (e) {
        r.errores.push({ suscriptorId: null, accion: "marcar", mensaje: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  const error = (suscriptorIds: string[] | null, accion: string, mensaje: string) => {
    r.errores.push({ suscriptorId: suscriptorIds?.[0] ?? null, accion, mensaje });
  };
  const sinTiempo = () => op.hastaMs !== undefined && ahora() >= op.hastaMs;

  let contactosResend = plan.contactosResend;
  // Destinatarios: activos con contacto suscrito dentro del Segment.
  const miembros = new Set(enSegmento.data.map((c) => c.id));
  const destinatarios = new Set<string>();
  const contactoDeGrupo = new Map<string, string>(); // contactId -> email (solo grupos activos cuadrados)
  {
    const porEmail = new Map(contactos.data.map((c) => [normalizarEmail(c.email), c] as const));
    for (const s of locales) {
      const k = normalizarEmail(s.email);
      if (!s.activo || suprimidas.has(k)) continue;
      const c = porEmail.get(k);
      if (c && !c.unsubscribed) contactoDeGrupo.set(c.id, k);
    }
    for (const id of contactoDeGrupo.keys()) if (miembros.has(id)) destinatarios.add(id);
  }

  type Paso = { bloqueante: boolean; correr: () => Promise<void> };
  const pasos: Paso[] = [];

  const borrarDeResend = async (contactId: string, ids: string[], accion: string, bloqueante: boolean): Promise<boolean> => {
    const res = await op.cliente.borrarContacto(contactId);
    if (res.ok || res.status === 404) {
      if (res.ok) contactosResend--;
      r.borrados += res.ok ? 1 : 0;
      destinatarios.delete(contactId);
      marcar(ids, null);
      return true;
    }
    error(ids, accion, `${res.status} ${res.tipo}: ${res.mensaje}`);
    if (bloqueante) r.bloqueaEnvio = true;
    return false;
  };

  // a) Reconciliación de bajas hechas en la página de Resend
  for (const b of plan.bajasNativas) {
    pasos.push({
      bloqueante: false, // un contacto unsubscribed no recibe Broadcasts aunque siga en Resend
      correr: async () => {
        let n = 0;
        try {
          n = await op.datos.registrarBajaNativa(b.email);
        } catch (e) {
          error(b.suscriptorIds, "baja_nativa", e instanceof Error ? e.message : String(e));
          return; // sin baja local no se borra en Resend: la siguiente pasada lo reintenta
        }
        r.bajasResend += n > 0 ? 1 : 0;
        await borrarDeResend(b.contactId, b.suscriptorIds, "borrar_baja_nativa", false);
      },
    });
  }
  // b) Borrar a los dados de baja
  for (const b of plan.borrar) {
    pasos.push({ bloqueante: true, correr: async () => void (await borrarDeResend(b.contactId, b.suscriptorIds, `borrar_${b.motivo}`, true)) });
  }
  // c) Fuera del Segment quien no es de la tabla
  for (const q of plan.quitarDeSegmento) {
    pasos.push({
      bloqueante: true,
      correr: async () => {
        const res = await op.cliente.quitarDeSegmento(q.contactId, segmentId);
        if (res.ok || res.status === 404) r.quitadosSegmento++;
        else {
          error(null, "quitar_segmento", `${res.status} ${res.tipo}: ${res.mensaje}`);
          r.bloqueaEnvio = true;
        }
      },
    });
  }
  // d) Altas, Segment y nombres
  for (const a of plan.crear) {
    pasos.push({
      bloqueante: false,
      correr: async () => {
        const res = await op.cliente.crearContacto(a.email, a.nombre, segmentId);
        if (res.ok && res.data?.id) {
          r.altas++;
          contactosResend++;
          destinatarios.add(res.data.id);
          marcar(a.suscriptorIds, res.data.id);
          return;
        }
        // ¿Ya existía (p. ej. creado en una pasada que murió antes de marcarlo)? Se mira y se cuadra.
        const existente = await op.cliente.obtenerContacto(a.email);
        if (!existente.ok) {
          error(a.suscriptorIds, "crear", res.ok ? "Resend no devolvió el id del contacto" : `${res.status} ${res.tipo}: ${res.mensaje}`);
          return;
        }
        const c = existente.data;
        if (c.unsubscribed) {
          try {
            const n = await op.datos.registrarBajaNativa(a.email);
            r.bajasResend += n > 0 ? 1 : 0;
          } catch (e) {
            error(a.suscriptorIds, "baja_nativa", e instanceof Error ? e.message : String(e));
            return;
          }
          await borrarDeResend(c.id, a.suscriptorIds, "borrar_baja_nativa", false);
          return;
        }
        const add = await op.cliente.anadirASegmento(c.id, segmentId);
        if (add.ok || yaEstaba(add)) {
          r.anadidosSegmento++;
          destinatarios.add(c.id);
          marcar(a.suscriptorIds, c.id);
        } else {
          error(a.suscriptorIds, "anadir_segmento", `${add.status} ${add.tipo}: ${add.mensaje}`);
        }
      },
    });
  }
  for (const s of plan.anadirASegmento) {
    pasos.push({
      bloqueante: false,
      correr: async () => {
        const res = await op.cliente.anadirASegmento(s.contactId, segmentId);
        if (res.ok || yaEstaba(res)) {
          r.anadidosSegmento++;
          destinatarios.add(s.contactId);
          marcar(s.suscriptorIds, s.contactId);
        } else {
          error(s.suscriptorIds, "anadir_segmento", `${res.status} ${res.tipo}: ${res.mensaje}`);
        }
      },
    });
  }
  for (const n of plan.actualizarNombre) {
    pasos.push({
      bloqueante: false,
      correr: async () => {
        const res = await op.cliente.actualizarNombre(n.contactId, n.nombre);
        if (res.ok) {
          r.actualizados++;
          marcar(n.suscriptorIds, n.contactId);
        } else {
          error(n.suscriptorIds, "actualizar_nombre", `${res.status} ${res.tipo}: ${res.mensaje}`);
        }
      },
    });
  }

  for (let i = 0; i < pasos.length; i++) {
    if (sinTiempo()) {
      const resto = pasos.slice(i);
      r.pendientes = resto.length;
      if (resto.some((p) => p.bloqueante)) r.bloqueaEnvio = true;
      log(`[newsletter-sync] Sin tiempo: quedan ${resto.length} acciones para la siguiente pasada`);
      break;
    }
    try {
      await pasos[i].correr();
    } catch (e) {
      error(null, "inesperado", e instanceof Error ? e.message : String(e));
      if (pasos[i].bloqueante) r.bloqueaEnvio = true;
    }
    await volcarMarcas();
  }
  await volcarMarcas(true);

  r.contactosResend = Math.max(0, contactosResend);
  r.contactosSegmento = Math.max(0, plan.contactosSegmento + r.altas + r.anadidosSegmento - r.quitadosSegmento - contarBorradosEnSegmento(plan, miembros, r));
  r.ajenos = plan.ajenos;
  r.destinatarios = destinatarios.size;
  r.peticiones = op.cliente.peticiones ?? 0;
  r.estado = r.errores.length > 0 || r.pendientes > 0 ? "parcial" : "ok";
  return r;
}

/** Aproximación de cuántos de los borrados estaban en el Segment (para el contador del panel). */
function contarBorradosEnSegmento(plan: Plan, miembros: Set<string>, r: ResumenSync): number {
  if (r.borrados === 0) return 0;
  const candidatos = [...plan.borrar.map((b) => b.contactId), ...plan.bajasNativas.map((b) => b.contactId)];
  const enSeg = candidatos.filter((id) => miembros.has(id)).length;
  return Math.min(enSeg, r.borrados);
}
