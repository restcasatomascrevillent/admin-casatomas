import { describe, expect, it } from "vitest";
import { mensajeFallo } from "../fallos";
import {
  aplicarTopes, type Aviso, construirResumen, construirSemanal, evaluarPendientes, fraseAviso, fraseReserva, incluirRevision, mensajeAviso,
  motivoSospechoso, notaTope, pendientesDeEnvio, type ReservaInfo, visibilidadReserva,
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
      aviso({ tipo: "facturas_precio_baja", titulo: "Baja", datos: { texto_telegram: "Baja X.", campana: true } }),
    ];
    const r = construirResumen(avisos, AHORA);
    expect(r.total).toBe(1);
    expect(r.texto).not.toContain("Proveedores nuevos");
  });

  it("margen bajo lleva el nombre del producto en el resumen", () => {
    const a = aviso({ datos: { canal: "peso", nombre: "Hueva de mújol", valor: 1.6, limite: 2, coste: 85, coste_antes: 57 } });
    const { texto } = construirResumen([a], AHORA);
    expect(texto).toContain("• Hueva de mújol: cobras 1,6 veces lo que pagas (mínimo 2,0). El kilo te cuesta 85,00 € (antes 57,00 €).");
    expect(fraseAviso(a)).toMatch(/^Cobras 1,6/); // suelto, el título ya dice el nombre
  });

  it("«Más barato en otro proveedor» no se corta antes del dato", () => {
    const a = aviso({
      tipo: "facturas_precio_mejor",
      mensaje: "Berberecho: en tu última compra, factura de PESCADOS A del 03/11/2026, lo pagaste a 32,00 €/kg. PESCADOS B te lo vendió a 27,00 €/kg.",
      datos: { producto: "Berberecho", proveedor: "PESCADOS A", proveedor_otro: "PESCADOS B", precio: 32, precio_otro: 27, medida: "kg", diferencia_pct: 15.6, ahorro: 120 },
    });
    const f = fraseAviso(a);
    expect(f).toContain("PESCADOS B lo vendió a 27,00 €/kg");
    expect(f).toContain("32,00 €/kg");
    const sinDatos = aviso({ tipo: "facturas_precio_mejor", datos: null, mensaje: "Va a 32,00 €/kg. PESCADOS B lo vende a 27,00 €/kg." });
    expect(fraseAviso(sinDatos)).toContain("PESCADOS B");
  });

  it("«Por revisar»: no se repite cada día; sí si cambia o pasa una semana", () => {
    expect(incluirRevision(190, undefined, "2026-11-11")).toBe(true);
    expect(incluirRevision(191, { n: 190, dia: "2026-11-10" }, "2026-11-11")).toBe(false);
    expect(incluirRevision(200, { n: 190, dia: "2026-11-10" }, "2026-11-11")).toBe(true);
    expect(incluirRevision(190, { n: 190, dia: "2026-11-03" }, "2026-11-11")).toBe(true);
    const av = aviso({ tipo: "facturas_revision", titulo: "190 docs", datos: { cuantos: 190, resumen: "avisos", texto_telegram: "190 documentos por revisar." } });
    expect(construirResumen([av], AHORA, null, { revision: { avisos: { n: 190, dia: "2026-11-10" } } }).total).toBe(0);
    const r = construirResumen([av], AHORA, null, {});
    expect(r.total).toBe(1);
    expect(r.revision.avisos).toEqual({ n: 190, dia: "2026-11-11" });
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
  it("la frase no lleva nombre ni teléfono", () => {
    const a = aviso({ tipo: "reserva_nueva", titulo: "Reserva nueva", mensaje: "Jorge Santos · 11/11 21:00 · 4 pers. · web", referencia_id: "r1" });
    expect(fraseReserva(a, reserva(), AHORA)).toBe("Reserva de 4 pax a las 21:00 · hoy, web");
    expect(fraseReserva(a, null, AHORA)).toBe("Reserva nueva: 11/11 21:00 · 4 pers. · web");
    const msg = mensajeAviso(a, null, null, { ahora: AHORA, reservas: mapa(reserva()) });
    expect(msg).toContain("Reserva de 4 pax a las 21:00");
    expect(msg).not.toContain("Jorge");
    const sol = aviso({ tipo: "solicitud_pendiente", titulo: "Solicitud de reserva para hoy", mensaje: "Ana - Tel: 600111222 - 10 pers." });
    expect(mensajeAviso(sol, null)).not.toMatch(/600111222|Ana/);
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

describe("avisos-telegram · topes y resumen semanal", () => {
  it("tope por hora y por día; el resto va en una nota", () => {
    const l = Array.from({ length: 15 }, (_, i) => i);
    expect(aplicarTopes(l, { hora: 0, dia: 0 }, { hora: 10, dia: 30 }).enviar).toHaveLength(10);
    expect(aplicarTopes(l, { hora: 8, dia: 0 }, { hora: 10, dia: 30 }).enviar).toEqual([0, 1]);
    expect(aplicarTopes(l, { hora: 0, dia: 29 }, { hora: 10, dia: 30 }).enviar).toEqual([0]);
    expect(aplicarTopes(l, { hora: 10, dia: 10 }, { hora: 10, dia: 30 }).enviar).toEqual([]);
    expect(aplicarTopes(l, { hora: 0, dia: 0 }, { hora: 10, dia: 30 }).resto).toHaveLength(5);
    expect(notaTope(5, "https://p.example")).toContain("5 avisos más");
    expect(notaTope(1)).toContain("1 aviso más");
  });

  it("semanal: vinos, tienda, facturas y albaranes con cifras y enlace; vacío si no hay nada", () => {
    const lunes = new Date("2026-11-16T08:00:00Z");
    const { texto, secciones } = construirSemanal({
      vinos: { limite: 2.3, bajo: 69, total: 85, peor: [{ nombre: "Vino A", multiplicador: 1.2 }] },
      tienda: { activa: true, limite: 1.5, bajo: 72, total: 90, bajo_coste: 10, peor: [{ nombre: "Vino B", multiplicador: 0.83 }] },
      facturas: { documentos: 1276, importe: 1440000, mayores: [{ proveedor: "Proveedor X", total: 12345.6, fecha: "2026-11-03" }] },
      albaranes: { n: 30, proveedores: 14, importe: 9305, mayores: [{ proveedor: "Proveedor Y", importe: 2100, n: 3 }] },
    }, lunes, "https://panel.example");
    expect(secciones).toBe(4);
    expect(texto).toContain("Vinos de la carta por debajo de ×2,3: 69 de 85");
    expect(texto).toContain("Tienda por debajo de ×1,5: 72 de 90 (10 se venden por debajo del coste)");
    expect(texto).toContain("Facturas por verificar: 1.276 documentos (1.440.000,00 €)");
    expect(texto).toContain("Albaranes sin factura: 9.305,00 € en 14 proveedores");
    expect(texto).toContain("https://panel.example/facturas?tab=margenes");
    expect(texto.length).toBeLessThan(1500);
    expect(construirSemanal({ vinos: { bajo: 0 }, albaranes: { n: 0 } }, lunes, null)).toEqual({ texto: "", secciones: 0 });
  });
});

describe("avisos-telegram · fallos graves (fallos.ts)", () => {
  const base = { id: 1, usuario: null, created_at: "2026-11-13T10:30:00Z" };
  it("OpenAI sin créditos", () => {
    const t = mensajeFallo({ ...base, tipo: "openai_sin_creditos", datos: { trabajos: 6, desde: "2026-11-13T09:00:00Z", ejemplo: "OpenAI embeddings 429: You have no credits" } });
    expect(t).toContain("OpenAI sin créditos");
    expect(t).toContain("fallidas por esto: 6");
    expect(t).toContain("no credits");
  });
  it("lecturas fallidas agrupadas con sus motivos", () => {
    const t = mensajeFallo({ ...base, tipo: "ocr_fallido", datos: { trabajos: 3, motivos: [{ error: "La extracción no cumple el contrato", n: 2 }, { error: "Tiempo agotado", n: 1 }] } });
    expect(t).toContain("Cuántas: 3");
    expect(t).toContain("- La extracción no cumple el contrato (2)");
  });
  it("cron caído: una línea por tarea", () => {
    const t = mensajeFallo({ ...base, tipo: "cron_caido", datos: { crons: [{ job: "reanudar-trabajos-ocr", minutos: 49, maximo: 30, error: "job startup timeout" }] } });
    expect(t).toContain("- reanudar-trabajos-ocr: 49 min sin éxito (máx. 30) · job startup timeout");
  });
  it("pulgar abajo y albarán dicen cuántos más se agruparon", () => {
    const d = { acumulados_antes: 4, acumulados_desde: "2026-11-13T09:00:00Z" };
    expect(mensajeFallo({ ...base, tipo: "chat_pulgar_abajo", datos: { pregunta: "p", ...d } })).toContain("Además: 4 pulgares abajo más");
    expect(mensajeFallo({ ...base, tipo: "albaran_aviso", datos: { factura_id: 3, avisos: [], ...d } })).toContain("Además: 4 avisos de albarán más");
  });
});
