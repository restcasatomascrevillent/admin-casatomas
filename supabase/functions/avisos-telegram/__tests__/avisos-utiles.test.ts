import { describe, expect, it } from "vitest";
import {
  aplicarTopes, type Aviso, casoCorto, construirResumen, construirSemanal, evaluarPendientes, incluirRevision, lineaAviso, lineaReserva, mensajeAviso,
  motivoSospechoso, notaTope, pendientesDeEnvio, type ReservaInfo, TOPE_RESERVAS_DIA, TOPE_RESERVAS_HORA, topesDeCanal, visibilidadReserva,
} from "../logica";

// Casos reales de la revisión de producción del 17/11/2026 (con nombres y cifras inventados).
const AHORA = new Date("2026-11-11T10:00:00Z"); // 11:00 en Madrid

let n = 0;
const aviso = (p: Partial<Aviso> = {}): Aviso => ({
  id: `u${++n}`,
  tipo: "facturas_margen_bajo",
  titulo: "Margen bajo",
  mensaje: null,
  referencia_tipo: "facturas_alerta",
  created_at: new Date(AHORA.getTime() - 10 * 60_000).toISOString(),
  datos: {},
  ...p,
});

const reserva = (p: Partial<ReservaInfo> = {}): ReservaInfo => ({
  id: "r1", fecha: "2026-11-11", hora: "21:00:00", numero_comensales: 4, canal: "web", estado: "confirmada", cancelada_por: null, ...p,
});
const mapa = (...rs: ReservaInfo[]) => new Map(rs.map((r) => [r.id, r]));
const CFG = { tipos_al_momento: ["facturas_margen_bajo"], activo_desde: "2026-11-10T00:00:00Z", reservas_al_momento: true };

describe("avisos-telegram · resumen útil", () => {
  it("no cuela los avisos con campana=false (Proveedores nuevos)", () => {
    const avisos = [
      aviso({ tipo: "facturas_proveedor_nuevo", titulo: "Proveedor nuevo", datos: { campana: false } }),
      aviso({ tipo: "facturas_precio_baja", titulo: "Baja X", datos: { campana: true } }),
    ];
    const r = construirResumen(avisos, AHORA);
    expect(r.total).toBe(1);
    expect(r.texto).not.toContain("Proveedores nuevos");
  });

  it("margen bajo: el nombre del artículo y su cifra; el peor primero", () => {
    const a = aviso({ datos: { canal: "plato", nombre: "Chuletón", valor: 41, limite: 35 } });
    const b = aviso({ datos: { canal: "plato", nombre: "Entrecot", valor: 38, limite: 35 } });
    const c = aviso({ datos: { canal: "plato", nombre: "Lubina", valor: 36, limite: 35 } });
    expect(casoCorto(a)).toBe("Chuletón 41 %");
    expect(construirResumen([c, b, a], AHORA).texto).toContain("⚠️ Margen bajo (3): Chuletón 41 %, Entrecot 38 % y 1 más");
  });

  it("«Por revisar»: su línea con la diferencia; no se repite cada día; sí si cambia o pasa una semana", () => {
    expect(incluirRevision(190, undefined, "2026-11-11")).toBe(true);
    expect(incluirRevision(191, { n: 190, dia: "2026-11-10" }, "2026-11-11")).toBe(false);
    expect(incluirRevision(200, { n: 190, dia: "2026-11-10" }, "2026-11-11")).toBe(true);
    expect(incluirRevision(190, { n: 190, dia: "2026-11-03" }, "2026-11-11")).toBe(true);
    const av = aviso({ tipo: "facturas_revision", titulo: "202 documentos con avisos sin revisar", datos: { cuantos: 202, resumen: "avisos" } });
    expect(construirResumen([av], AHORA, null, { revision: { avisos: { n: 200, dia: "2026-11-10" } } }).total).toBe(0);
    const r = construirResumen([av], AHORA, null, { revision: { avisos: { n: 190, dia: "2026-11-10" } } });
    expect(r.texto).toBe("Resumen 11/11 · 1 aviso\n📋 Por revisar: 202 docs (+12)");
    expect(r.revision.avisos).toEqual({ n: 202, dia: "2026-11-11" });
    const dup = aviso({ tipo: "facturas_revision", titulo: "Duplicados", datos: { cuantos: 3, resumen: "duplicados" } });
    expect(construirResumen([dup], AHORA).texto).toContain("📋 Posibles duplicados: 3 docs");
  });

  it("no manda nada si no queda nada que contar", () => {
    expect(construirResumen([], AHORA)).toMatchObject({ texto: "", total: 0 });
    expect(construirResumen([aviso({ tipo: "facturas_proveedor_nuevo", datos: { campana: false } })], AHORA).texto).toBe("");
  });
});

describe("avisos-telegram · unidades dudosas", () => {
  it("quita la hueva de mújol 1,58 € → 70 € de «al momento» y del resumen", () => {
    const a = aviso({ datos: { canal: "peso", nombre: "Hueva mujol", valor: 1.2, limite: 2, coste: 70, coste_antes: 1.58 } });
    expect(motivoSospechoso(a)).toMatch(/unidades dudosas/);
    expect(construirResumen([a], AHORA).total).toBe(0);
    const ev = evaluarPendientes([a], [], CFG, AHORA);
    expect(ev.enviar).toEqual([]);
    expect(ev.descartar).toHaveLength(1);
    expect(ev.descartar[0].motivo).toMatch(/^descartado/);
  });
  it("no toca los saltos normales", () => {
    expect(motivoSospechoso(aviso({ datos: { canal: "vino", coste: 12, coste_antes: 10 } }))).toBeNull();
    expect(motivoSospechoso(aviso({ tipo: "facturas_precio_sube", datos: { precio: 50, precio_ref: 2 } }))).toMatch(/dudosas/);
    expect(motivoSospechoso(aviso({ tipo: "facturas_precio_sube", datos: { precio: 178, precio_ref: 136 } }))).toBeNull();
  });
});

describe("avisos-telegram · reservas sin datos personales", () => {
  it("la línea no lleva nombre ni teléfono", () => {
    const a = aviso({ tipo: "reserva_nueva", titulo: "Reserva nueva", mensaje: "Jorge Santos · 11/11 21:00 · 4 pers. · web", referencia_id: "r1" });
    expect(lineaReserva(a, reserva(), AHORA)).toBe("Reserva hoy 21:00 · 4 pax · web");
    expect(lineaReserva(a, null, AHORA)).toBe("Reserva: 11/11 21:00 · 4 pers. · web");
    expect(mensajeAviso(a, "https://panel.example", null, { ahora: AHORA, reservas: mapa(reserva()) })).toBe("🟢 Reserva hoy 21:00 · 4 pax · web");
    const canc = aviso({ tipo: "reserva_cancelada", titulo: "Reserva cancelada", mensaje: "Jorge Santos · 12/11 14:00 · 2 pers. · web · la canceló el cliente", referencia_id: "r2" });
    expect(mensajeAviso(canc, null, null, { ahora: AHORA, reservas: mapa(reserva({ id: "r2", fecha: "2026-11-12", hora: "14:00:00", numero_comensales: 2, cancelada_por: "cliente" })) }))
      .toBe("🔴 Cancelada mañana 14:00 · 2 pax · la canceló el cliente");
    expect(lineaReserva(canc, null, AHORA)).toBe("Cancelada: 12/11 14:00 · 2 pers. · web");
    const sol = aviso({ tipo: "solicitud_pendiente", titulo: "Solicitud de reserva para hoy", mensaje: "Ana - Tel: 600111222 - 10 pers." });
    expect(mensajeAviso(sol, null)).toBe("🟡 Solicitud de reserva para hoy");
    expect(lineaAviso(sol)).not.toMatch(/600111222|Ana/);
  });

  it("otro día: «vie 20/11»; en el resumen, solo cuándo y cuántos", () => {
    const a = aviso({ tipo: "reserva_nueva", titulo: "Reserva nueva", referencia_id: "r3" });
    const reservas = mapa(reserva({ id: "r3", fecha: "2026-11-20", hora: "13:30:00", numero_comensales: 6 }));
    expect(lineaAviso(a, { ahora: AHORA, reservas })).toBe("Reserva vie 20/11 13:30 · 6 pax · web");
    expect(casoCorto(a, { ahora: AHORA, reservas })).toBe("vie 20/11 13:30 (6 pax)");
  });

  it("no avisa de cancelaciones del restaurante ni de reservas pendientes de verificar", () => {
    const nueva = aviso({ tipo: "reserva_nueva", referencia_id: "r1" });
    const canc = aviso({ tipo: "reserva_cancelada", referencia_id: "r1" });
    expect(visibilidadReserva(nueva, mapa(reserva({ estado: "pendiente" })))).toBe("espera");
    expect(visibilidadReserva(nueva, mapa(reserva({ estado: "verificada" })))).toBe("si");
    expect(visibilidadReserva(nueva, mapa(reserva({ estado: "cancelada" })))).toBe("no");
    expect(visibilidadReserva(canc, mapa(reserva({ cancelada_por: "restaurante" })))).toBe("no");
    expect(visibilidadReserva(canc, mapa(reserva({ cancelada_por: "cliente" })))).toBe("si");
    const r = construirResumen([nueva, canc], AHORA, null, { reservas: mapa(reserva({ estado: "pendiente" })) });
    expect(r.total).toBe(1); // solo la cancelación (no consta quién)
  });

  it("al momento: hoy y mañana sí; otro día no; pendientes esperan; manuales se descartan", () => {
    const hoy = aviso({ id: "h", tipo: "reserva_nueva", referencia_id: "r1" });
    const manana = aviso({ id: "m", tipo: "reserva_nueva", referencia_id: "r2" });
    const lejos = aviso({ id: "l", tipo: "reserva_nueva", referencia_id: "r3" });
    const pend = aviso({ id: "p", tipo: "reserva_nueva", referencia_id: "r4" });
    const manual = aviso({ id: "x", tipo: "reserva_cancelada", referencia_id: "r5" });
    const reservas = mapa(
      reserva({ id: "r1" }), reserva({ id: "r2", fecha: "2026-11-12" }), reserva({ id: "r3", fecha: "2026-11-20" }),
      reserva({ id: "r4", estado: "pendiente" }), reserva({ id: "r5", cancelada_por: "restaurante" }),
    );
    const ev = evaluarPendientes([hoy, manana, lejos, pend, manual], [], CFG, AHORA, { reservas });
    expect(ev.enviar.map((a) => a.id)).toEqual(["h", "m"]);
    expect(ev.descartar.map((d) => d.aviso.id)).toEqual(["x"]);
    expect(pendientesDeEnvio([hoy], [], { ...CFG, reservas_al_momento: false }, AHORA, { reservas })).toEqual([]);
  });
});

describe("avisos-telegram · topes por canal y resumen semanal", () => {
  it("tope por hora y por día; el resto va en una nota", () => {
    const l = Array.from({ length: 15 }, (_, i) => i);
    expect(aplicarTopes(l, { hora: 0, dia: 0 }, { hora: 10, dia: 30 }).enviar).toHaveLength(10);
    expect(aplicarTopes(l, { hora: 8, dia: 0 }, { hora: 10, dia: 30 }).enviar).toEqual([0, 1]);
    expect(aplicarTopes(l, { hora: 0, dia: 29 }, { hora: 10, dia: 30 }).enviar).toEqual([0]);
    expect(aplicarTopes(l, { hora: 10, dia: 10 }, { hora: 10, dia: 30 }).enviar).toEqual([]);
    expect(aplicarTopes(l, { hora: 0, dia: 0 }, { hora: 10, dia: 30 }).resto).toHaveLength(5);
    expect(notaTope(5, "https://p.example")).toBe("➕ 5 avisos más (demasiados seguidos), en el panel\nhttps://p.example/avisos");
    expect(notaTope(1)).toBe("➕ 1 aviso más (demasiados seguidos), en el panel.");
  });

  it("cada canal tiene su tope: Reservas el suyo; Facturas el configurable", () => {
    expect(topesDeCanal("reservas", { tope_hora: 3, tope_dia: 5 })).toEqual({ hora: TOPE_RESERVAS_HORA, dia: TOPE_RESERVAS_DIA });
    expect(topesDeCanal("facturas", { tope_hora: 3, tope_dia: 5 })).toEqual({ hora: 3, dia: 5 });
    expect(topesDeCanal("facturas", {})).toEqual({ hora: 10, dia: 30 });
  });

  it("semanal: una línea por cosa, con los 2 peores y el total de albaranes si hay más", () => {
    const lunes = new Date("2026-11-16T08:00:00Z");
    const { texto, secciones } = construirSemanal({
      vinos: { limite: 2.3, bajo: 69, total: 85, peor: [{ nombre: "Vino A", multiplicador: 1.2 }, { nombre: "Vino B", multiplicador: 1.5 }, { nombre: "Vino C", multiplicador: 1.6 }] },
      tienda: { activa: true, limite: 1.5, bajo: 72, total: 90, bajo_coste: 10, peor: [{ nombre: "Vino D", multiplicador: 0.83 }] },
      facturas: { documentos: 1276, importe: 1440000, mayores: [{ proveedor: "PROVEEDOR X S.L.", total: 12345.6, fecha: "2026-11-03" }] },
      albaranes: { n: 22, proveedores: 14, importe: 9304.88, total_n: 113, total_proveedores: 42, total_importe: 46734.15 },
    }, lunes, "https://panel.example");
    expect(secciones).toBe(4);
    expect(texto).toBe(
      "📅 Semana 16/11\n" +
        "🍷 Vinos bajo ×2,3: 69 de 85 · peores: Vino A ×1,2, Vino B ×1,5\n" +
        "🛒 Tienda bajo ×1,5: 72 de 90 (10 bajo coste) · peores: Vino D ×0,83\n" +
        "📋 Facturas por verificar: 1.276 (1.440.000 €) · mayor: Proveedor X 12.346 €\n" +
        "🧾 Albaranes sin factura +35 días: 9.305 € en 14 proveedores · en total 113 (46.734 €)\n" +
        "Márgenes: https://panel.example/facturas?tab=margenes\n" +
        "Facturas: https://panel.example/facturas?tab=compras&modo=documentos",
    );
  });

  it("semanal: sin totales no se inventa la parte «en total»; vacío si no hay nada", () => {
    const lunes = new Date("2026-11-16T08:00:00Z");
    expect(construirSemanal({ albaranes: { n: 1, proveedores: 1, importe: 300 } }, lunes, null).texto)
      .toBe("📅 Semana 16/11\n🧾 Albaranes sin factura +35 días: 300 € en 1 proveedor");
    expect(construirSemanal({ vinos: { bajo: 0 }, albaranes: { n: 0 } }, lunes, null)).toEqual({ texto: "", secciones: 0 });
  });
});
