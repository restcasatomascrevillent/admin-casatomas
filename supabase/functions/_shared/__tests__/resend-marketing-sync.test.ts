/**
 * Sincronización tabla -> Resend Marketing (_shared/resend-marketing/sync.ts).
 * Resend simulado en memoria: estos tests nunca llaman a Resend.
 */
import { describe, it, expect } from "vitest";
import { planificarSync, sincronizar, resolverSegmento, type ClienteSync, type DatosSync, type SuscriptorLocal } from "../resend-marketing/sync.ts";
import type { ContactoResend, ResultadoResend } from "../resend-marketing/cliente.ts";

const ok = <T>(data: T, status = 200): ResultadoResend<T> => ({ ok: true, status, data });
const ko = (status: number, tipo = "error", mensaje = "fallo"): ResultadoResend<never> => ({ ok: false, status, tipo, mensaje });

function local(id: string, email: string, activo = true, extra: Partial<SuscriptorLocal> = {}): SuscriptorLocal {
  return { id, email, nombre: null, activo, resend_contact_id: null, ...extra };
}
function contacto(id: string, email: string, unsubscribed = false, first_name: string | null = null): ContactoResend {
  return { id, email, unsubscribed, first_name };
}

// ---------------------------------------------------------------------------
// Resend falso: estado en memoria + registro de llamadas
// ---------------------------------------------------------------------------
class ResendFalso implements ClienteSync {
  contactos = new Map<string, ContactoResend>();
  segmentos = new Map<string, { name: string; miembros: Set<string> }>();
  llamadas: string[] = [];
  fallos: Partial<Record<string, ResultadoResend<never>>> = {};
  peticiones = 0;
  private n = 0;

  constructor(segmentId = "seg-1") {
    this.segmentos.set(segmentId, { name: "Newsletter Casa Tomás", miembros: new Set() });
  }
  meter(c: ContactoResend, enSegmento = true, segmentId = "seg-1") {
    this.contactos.set(c.id, c);
    if (enSegmento) this.segmentos.get(segmentId)!.miembros.add(c.id);
  }
  private reg(op: string) {
    this.llamadas.push(op);
    this.peticiones++;
    return this.fallos[op.split(" ")[0]];
  }
  async listarContactos() {
    return this.reg("listar") ?? ok([...this.contactos.values()]);
  }
  async listarContactosSegmento(id: string) {
    const f = this.reg("listarSegmento");
    if (f) return f;
    const s = this.segmentos.get(id);
    if (!s) return ko(404, "not_found", "segment not found");
    return ok([...s.miembros].map((m) => this.contactos.get(m)!).filter(Boolean));
  }
  async listarSegmentos() {
    return this.reg("listarSegmentos") ?? ok([...this.segmentos.entries()].map(([id, s]) => ({ id, name: s.name })));
  }
  async crearSegmento(nombre: string) {
    const f = this.reg(`crearSegmento ${nombre}`);
    if (f) return f;
    const id = `seg-nuevo-${++this.n}`;
    this.segmentos.set(id, { name: nombre, miembros: new Set() });
    return ok({ id });
  }
  async obtenerContacto(idOEmail: string) {
    const f = this.reg(`obtener ${idOEmail}`);
    if (f) return f;
    const c = [...this.contactos.values()].find((x) => x.id === idOEmail || x.email.toLowerCase() === idOEmail.toLowerCase());
    return c ? ok(c) : ko(404, "not_found", "Contact not found");
  }
  async crearContacto(email: string, nombre: string | null, segmentId: string) {
    const f = this.reg(`crear ${email}`);
    if (f) return f;
    if ([...this.contactos.values()].some((c) => c.email.toLowerCase() === email.toLowerCase())) return ko(409, "validation_error", "Contact already exists");
    const id = `c-nuevo-${++this.n}`;
    this.contactos.set(id, { id, email, first_name: nombre, unsubscribed: false });
    this.segmentos.get(segmentId)!.miembros.add(id);
    return ok({ id }, 201);
  }
  async actualizarNombre(id: string, nombre: string) {
    const f = this.reg(`nombre ${id}`);
    if (f) return f;
    this.contactos.get(id)!.first_name = nombre;
    return ok({ id });
  }
  async borrarContacto(id: string) {
    const f = this.reg(`borrar ${id}`);
    if (f) return f;
    if (!this.contactos.delete(id)) return ko(404, "not_found", "Contact not found");
    for (const s of this.segmentos.values()) s.miembros.delete(id);
    return ok({ deleted: true });
  }
  async anadirASegmento(id: string, seg: string) {
    const f = this.reg(`anadir ${id}`);
    if (f) return f;
    this.segmentos.get(seg)!.miembros.add(id);
    return ok({ id: seg });
  }
  async quitarDeSegmento(id: string, seg: string) {
    const f = this.reg(`quitar ${id}`);
    if (f) return f;
    this.segmentos.get(seg)!.miembros.delete(id);
    return ok({});
  }
}

class TablaFalsa implements DatosSync {
  bajas: string[] = [];
  marcas: { id: string; contact_id: string | null }[] = [];
  fallaBaja = false;
  constructor(public filas: SuscriptorLocal[], public suprimidas = new Set<string>()) {}
  async leerSuscriptores() {
    return this.filas.map((f) => ({ ...f }));
  }
  async leerSuprimidas() {
    return this.suprimidas;
  }
  async registrarBajaNativa(email: string) {
    if (this.fallaBaja) throw new Error("rpc caída");
    this.bajas.push(email);
    let n = 0;
    for (const f of this.filas) if (f.activo && f.email.toLowerCase() === email) { f.activo = false; n++; }
    return n;
  }
  async marcarSincronizados(items: { id: string; contact_id: string | null }[]) {
    this.marcas.push(...items);
    for (const i of items) {
      const f = this.filas.find((x) => x.id === i.id);
      if (f) f.resend_contact_id = i.contact_id;
    }
  }
}

const correr = (resend: ResendFalso, tabla: TablaFalsa, extra: Partial<Parameters<typeof sincronizar>[0]> = {}) =>
  sincronizar({ cliente: resend, datos: tabla, segmentIdConfigurado: "seg-1", nombreSegmento: "Newsletter Casa Tomás", log: () => {}, ...extra });

// ---------------------------------------------------------------------------

describe("planificarSync", () => {
  it("activo sin contacto -> alta; dado de baja con contacto -> borrar; ajeno -> solo se cuenta", () => {
    const plan = planificarSync({
      locales: [local("1", "Ana@X.es", true, { nombre: "Ana" }), local("2", "baja@x.es", false)],
      suprimidas: new Set(),
      contactos: [contacto("c2", "baja@x.es"), contacto("c9", "otro@x.es")],
      enSegmento: [contacto("c2", "baja@x.es")],
    });
    expect(plan.crear).toEqual([{ suscriptorIds: ["1"], email: "ana@x.es", nombre: "Ana" }]);
    expect(plan.borrar).toEqual([{ contactId: "c2", suscriptorIds: ["2"], motivo: "baja" }]);
    expect(plan.ajenos).toBe(1);
    expect(plan.quitarDeSegmento).toEqual([]);
  });

  it("activo con contacto unsubscribed en Resend -> baja nativa (nunca se re-suscribe)", () => {
    const plan = planificarSync({
      locales: [local("1", "a@x.es")],
      suprimidas: new Set(),
      contactos: [contacto("c1", "a@x.es", true)],
      enSegmento: [contacto("c1", "a@x.es", true)],
    });
    expect(plan.bajasNativas).toEqual([{ email: "a@x.es", suscriptorIds: ["1"], contactId: "c1" }]);
    expect(plan.crear).toEqual([]);
    expect(plan.anadirASegmento).toEqual([]);
    expect(plan.actualizarNombre).toEqual([]);
  });

  it("incremental: un activo ya cuadrado no genera ninguna acción en Resend", () => {
    const plan = planificarSync({
      locales: [local("1", "a@x.es", true, { nombre: "Ana", resend_contact_id: "c1" })],
      suprimidas: new Set(),
      contactos: [contacto("c1", "a@x.es", false, "Ana")],
      enSegmento: [contacto("c1", "a@x.es")],
    });
    expect(plan).toMatchObject({ crear: [], borrar: [], bajasNativas: [], anadirASegmento: [], actualizarNombre: [], vincular: [], yaCuadrados: 1 });
  });

  it("contacto existente fuera del Segment -> añadir; nombre distinto -> actualizar; sin vincular -> vincular", () => {
    const plan = planificarSync({
      locales: [local("1", "a@x.es", true, { nombre: "Ana María" })],
      suprimidas: new Set(),
      contactos: [contacto("c1", "a@x.es", false, "Ana")],
      enSegmento: [],
    });
    expect(plan.anadirASegmento).toEqual([{ contactId: "c1", suscriptorIds: ["1"] }]);
    expect(plan.actualizarNombre).toEqual([{ contactId: "c1", suscriptorIds: ["1"], nombre: "Ana María" }]);
    expect(plan.vincular).toEqual([{ suscriptorId: "1", contactId: "c1" }]);
  });

  it("activo con dirección suprimida -> fuera de Resend (y no se crea)", () => {
    const plan = planificarSync({
      locales: [local("1", "rebota@x.es"), local("2", "nueva-rebota@x.es")],
      suprimidas: new Set(["rebota@x.es", "nueva-rebota@x.es"]),
      contactos: [contacto("c1", "rebota@x.es")],
      enSegmento: [contacto("c1", "rebota@x.es")],
    });
    expect(plan.borrar).toEqual([{ contactId: "c1", suscriptorIds: ["1"], motivo: "suprimida" }]);
    expect(plan.crear).toEqual([]);
  });

  it("contacto ajeno metido en el Segment -> se quita del Segment (no se borra)", () => {
    const plan = planificarSync({
      locales: [],
      suprimidas: new Set(),
      contactos: [contacto("c9", "ajeno@x.es")],
      enSegmento: [contacto("c9", "ajeno@x.es")],
    });
    expect(plan.quitarDeSegmento).toEqual([{ contactId: "c9" }]);
    expect(plan.borrar).toEqual([]);
  });

  it("dado de baja que ya no está en Resend pero conserva resend_contact_id -> se desvincula", () => {
    const plan = planificarSync({
      locales: [local("1", "a@x.es", false, { resend_contact_id: "c-viejo" })],
      suprimidas: new Set(),
      contactos: [],
      enSegmento: [],
    });
    expect(plan.vincular).toEqual([{ suscriptorId: "1", contactId: null }]);
  });

  it("mismo email con mayúsculas distintas cuenta como una persona", () => {
    const plan = planificarSync({
      locales: [local("1", "A@x.es", true), local("2", "a@x.es", false)],
      suprimidas: new Set(),
      contactos: [],
      enSegmento: [],
    });
    expect(plan.crear).toEqual([{ suscriptorIds: ["1", "2"], email: "a@x.es", nombre: null }]);
  });
});

describe("resolverSegmento", () => {
  it("usa el id configurado sin llamar a Resend", async () => {
    const r = new ResendFalso();
    expect(await resolverSegmento(r, " seg-x ", "N")).toEqual({ ok: true, id: "seg-x", creado: false });
    expect(r.llamadas).toEqual([]);
  });
  it("busca por nombre (sin distinguir mayúsculas)", async () => {
    const r = new ResendFalso("seg-7");
    expect(await resolverSegmento(r, null, "newsletter casa tomás")).toEqual({ ok: true, id: "seg-7", creado: false });
  });
  it("lo crea si no existe", async () => {
    const r = new ResendFalso("seg-7");
    const res = await resolverSegmento(r, "", "Otro");
    expect(res).toMatchObject({ ok: true, creado: true });
    expect(r.llamadas).toContain("crearSegmento Otro");
  });
});

describe("sincronizar", () => {
  it("primera pasada: crea a los activos dentro del Segment y guarda su contact_id", async () => {
    const resend = new ResendFalso();
    const tabla = new TablaFalsa([local("1", "a@x.es", true, { nombre: "Ana" }), local("2", "b@x.es"), local("3", "c@x.es", false)]);
    const r = await correr(resend, tabla);
    expect(r).toMatchObject({ estado: "ok", altas: 2, borrados: 0, destinatarios: 2, contactosResend: 2, bloqueaEnvio: false });
    expect(resend.segmentos.get("seg-1")!.miembros.size).toBe(2);
    expect(tabla.filas.find((f) => f.id === "1")!.resend_contact_id).toMatch(/^c-nuevo-/);
    expect(tabla.filas.find((f) => f.id === "3")!.resend_contact_id).toBeNull();
  });

  it("segunda pasada sin cambios: solo lecturas (incremental)", async () => {
    const resend = new ResendFalso();
    const tabla = new TablaFalsa([local("1", "a@x.es", true, { nombre: "Ana" })]);
    await correr(resend, tabla);
    resend.llamadas = [];
    tabla.marcas = [];
    const r = await correr(resend, tabla);
    expect(resend.llamadas).toEqual(["listar", "listarSegmento"]);
    expect(tabla.marcas).toEqual([]);
    expect(r).toMatchObject({ estado: "ok", altas: 0, destinatarios: 1 });
  });

  it("borra de Resend a quien se dio de baja en la tabla ANTES de dar altas", async () => {
    const resend = new ResendFalso();
    resend.meter(contacto("c1", "baja@x.es"));
    const tabla = new TablaFalsa([local("1", "baja@x.es", false, { resend_contact_id: "c1" }), local("2", "nuevo@x.es")]);
    const r = await correr(resend, tabla);
    const iBorrar = resend.llamadas.indexOf("borrar c1");
    const iCrear = resend.llamadas.indexOf("crear nuevo@x.es");
    expect(iBorrar).toBeGreaterThan(-1);
    expect(iBorrar).toBeLessThan(iCrear);
    expect(r).toMatchObject({ borrados: 1, altas: 1, destinatarios: 1, contactosResend: 1 });
    expect(tabla.filas.find((f) => f.id === "1")!.resend_contact_id).toBeNull();
  });

  it("reconciliación: baja en la página de Resend -> baja en la tabla (resend_baja_nativa) y después se borra el contacto", async () => {
    const resend = new ResendFalso();
    resend.meter(contacto("c1", "a@x.es", true));
    const tabla = new TablaFalsa([local("1", "a@x.es", true, { resend_contact_id: "c1" })]);
    const r = await correr(resend, tabla);
    expect(tabla.bajas).toEqual(["a@x.es"]);
    expect(tabla.filas[0].activo).toBe(false);
    expect(resend.llamadas).toContain("borrar c1");
    expect(r).toMatchObject({ bajasResend: 1, borrados: 1, destinatarios: 0 });
    // Nunca se intenta "arreglar" el contacto re-suscribiéndolo.
    expect(resend.llamadas.some((l) => l.startsWith("nombre") || l.startsWith("anadir") || l.startsWith("crear"))).toBe(false);
  });

  it("si la baja local falla, NO se borra el contacto (la siguiente pasada lo reintenta) y no bloquea el envío", async () => {
    const resend = new ResendFalso();
    resend.meter(contacto("c1", "a@x.es", true));
    const tabla = new TablaFalsa([local("1", "a@x.es")]);
    tabla.fallaBaja = true;
    const r = await correr(resend, tabla);
    expect(resend.llamadas).not.toContain("borrar c1");
    expect(r.estado).toBe("parcial");
    expect(r.errores[0]).toMatchObject({ accion: "baja_nativa", suscriptorId: "1" });
    expect(r.bloqueaEnvio).toBe(false);
  });

  it("si falla borrar a un dado de baja, BLOQUEA el envío", async () => {
    const resend = new ResendFalso();
    resend.meter(contacto("c1", "baja@x.es"));
    resend.fallos["borrar"] = ko(500, "application_error", "boom");
    const tabla = new TablaFalsa([local("1", "baja@x.es", false)]);
    const r = await correr(resend, tabla);
    expect(r).toMatchObject({ estado: "parcial", bloqueaEnvio: true, borrados: 0 });
  });

  it("borrar algo que ya no existe (404) cuenta como hecho", async () => {
    const resend = new ResendFalso();
    resend.meter(contacto("c1", "baja@x.es"));
    resend.fallos["borrar"] = ko(404, "not_found", "Contact not found");
    const tabla = new TablaFalsa([local("1", "baja@x.es", false, { resend_contact_id: "c1" })]);
    const r = await correr(resend, tabla);
    expect(r).toMatchObject({ estado: "ok", bloqueaEnvio: false });
    expect(tabla.filas[0].resend_contact_id).toBeNull();
  });

  it("un alta que falla no bloquea el envío (ese suscriptor no lo recibe)", async () => {
    const resend = new ResendFalso();
    resend.fallos["crear"] = ko(422, "validation_error", "invalid email");
    resend.fallos["obtener"] = ko(404, "not_found", "nope");
    const tabla = new TablaFalsa([local("1", "mal@x")]);
    const r = await correr(resend, tabla);
    expect(r).toMatchObject({ estado: "parcial", altas: 0, bloqueaEnvio: false, destinatarios: 0 });
    expect(r.errores[0]).toMatchObject({ suscriptorId: "1", accion: "crear" });
  });

  it("alta de un contacto que ya existía (pasada anterior a medias): se busca y se mete en el Segment", async () => {
    const resend = new ResendFalso();
    const tabla = new TablaFalsa([local("1", "a@x.es")]);
    // La lista dice que no existe (p. ej. se creó justo después de listar)...
    resend.fallos["crear"] = ko(409, "validation_error", "Contact already exists");
    resend.contactos.set("c5", contacto("c5", "a@x.es"));
    const listar = resend.listarContactos.bind(resend);
    resend.listarContactos = async () => (await listar(), ok([]));
    const r = await correr(resend, tabla);
    expect(resend.llamadas).toContain("anadir c5");
    expect(r).toMatchObject({ anadidosSegmento: 1, destinatarios: 1 });
    expect(tabla.filas[0].resend_contact_id).toBe("c5");
  });

  it("sin tiempo: deja el resto pendiente; si lo pendiente incluye borrados, bloquea el envío", async () => {
    const resend = new ResendFalso();
    resend.meter(contacto("c1", "baja1@x.es"));
    resend.meter(contacto("c2", "baja2@x.es"));
    const tabla = new TablaFalsa([local("1", "baja1@x.es", false), local("2", "baja2@x.es", false), local("3", "n@x.es")]);
    let t = 0;
    const r = await correr(resend, tabla, {
      hastaMs: 1,
      ahora: () => t++, // la primera acción entra (t=0), la segunda ya no
    });
    expect(r.pendientes).toBe(2);
    expect(r.bloqueaEnvio).toBe(true);
    expect(r.estado).toBe("parcial");
  });

  it("si no se puede listar Resend: estado error y bloquea el envío", async () => {
    const resend = new ResendFalso();
    resend.fallos["listar"] = ko(401, "restricted_api_key", "This API key is restricted to only send emails");
    const r = await correr(resend, new TablaFalsa([local("1", "a@x.es")]));
    expect(r).toMatchObject({ estado: "error", bloqueaEnvio: true });
    expect(r.mensajeError).toMatch(/restricted_api_key/);
  });

  it("Segment configurado que no existe: error claro", async () => {
    const resend = new ResendFalso();
    const r = await correr(resend, new TablaFalsa([]), { segmentIdConfigurado: "seg-inexistente" });
    expect(r.estado).toBe("error");
    expect(r.mensajeError).toMatch(/seg-inexistente/);
  });

  it("sin Segment configurado lo crea y no lista sus contactos (está vacío)", async () => {
    const resend = new ResendFalso("seg-de-otra-cosa");
    resend.segmentos.get("seg-de-otra-cosa")!.name = "Otra lista";
    const tabla = new TablaFalsa([local("1", "a@x.es")]);
    const r = await correr(resend, tabla, { segmentIdConfigurado: null });
    expect(r.segmentoCreado).toBe(true);
    expect(r.segmentId).toMatch(/^seg-nuevo-/);
    expect(resend.llamadas).not.toContain("listarSegmento");
    expect(r.altas).toBe(1);
  });

  it("quita del Segment a un contacto ajeno y no lo cuenta como destinatario", async () => {
    const resend = new ResendFalso();
    resend.meter(contacto("c9", "ajeno@x.es"));
    resend.meter(contacto("c1", "a@x.es"));
    const tabla = new TablaFalsa([local("1", "a@x.es", true, { resend_contact_id: "c1" })]);
    const r = await correr(resend, tabla);
    expect(resend.llamadas).toContain("quitar c9");
    expect(resend.contactos.has("c9")).toBe(true);
    expect(r).toMatchObject({ quitadosSegmento: 1, ajenos: 1, destinatarios: 1, contactosResend: 2 });
  });
});
