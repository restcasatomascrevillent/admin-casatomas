import { describe, expect, it } from "vitest";
import {
  agruparPasos, aTextoPlano, bloqueReservas, construirResumen, cuerpoSendMessage, diaSemanaMadrid, lineaPasoReserva, type PasoReserva, type ReservaInfo,
} from "../logica";

// 23/11/2026, dueño: «solo me ha salido reserva nueva, tiene que salir más información: si es petición, si ya ha sido
// aceptada, si el usuario la ha confirmado…».
const AHORA = new Date("2026-11-23T10:00:00Z"); // lunes 23/11, 11:00 en Madrid
const PANEL = "https://panel.example";

const reserva = (p: Partial<ReservaInfo> = {}): ReservaInfo => ({
  id: "r1", fecha: "2026-11-24", hora: "14:00:00", numero_comensales: 4, canal: "web", estado: "pendiente", cancelada_por: null, ...p,
});
let n = 0;
const paso = (evento: string, p: Partial<PasoReserva> = {}): PasoReserva => ({
  id: ++n, reserva_id: "r1", evento, quien: null, estado: null, created_at: new Date(AHORA.getTime() + n * 1000).toISOString(), ...p,
});
const linea = (evento: string, r: ReservaInfo, p: Partial<PasoReserva> = {}) => lineaPasoReserva({ ultimo: paso(evento, p), nueva: false }, r, AHORA, PANEL);

describe("avisos-telegram · un aviso por paso de la reserva", () => {
  it("petición por aceptar, con el enlace para aceptarla", () => {
    expect(lineaPasoReserva({ ultimo: paso("nueva"), nueva: true }, reserva(), AHORA, PANEL))
      .toBe('🟡 <b>Petición de reserva</b> · por aceptar\nmañana 14:00 · 4 pax · web · <a href="https://panel.example/reservas?avisos=reservas">Aceptar</a>');
  });
  it("reserva que entra ya aceptada (por teléfono) o ya confirmada", () => {
    expect(lineaPasoReserva({ ultimo: paso("nueva"), nueva: true }, reserva({ estado: "verificada", canal: "telefono" }), AHORA, PANEL))
      .toBe("🆕 <b>Reserva nueva</b> · ya aceptada\nmañana 14:00 · 4 pax · teléfono");
    expect(lineaPasoReserva({ ultimo: paso("nueva"), nueva: true }, reserva({ estado: "confirmada" }), AHORA, PANEL)).toContain("ya confirmada");
  });
  it("aceptada: dice si falta que confirme el cliente", () => {
    expect(linea("aceptada", reserva({ estado: "verificada", fecha: "2026-11-27", hora: "15:30:00", numero_comensales: 6 }), { quien: "restaurante" }))
      .toBe("✅ <b>Aceptada</b> · falta que confirme el cliente\nvie 27/11 15:30 · 6 pax · web");
    expect(linea("aceptada", reserva({ estado: "confirmada" }))).toContain("ya confirmada");
  });
  it("confirmada por el cliente o desde el panel", () => {
    expect(linea("confirmada", reserva({ estado: "confirmada" }), { quien: "cliente" })).toBe("🟢 <b>Confirmada por el cliente</b>\nmañana 14:00 · 4 pax · web");
    expect(linea("confirmada", reserva({ estado: "confirmada" }), { quien: "restaurante" })).toBe("🟢 <b>Confirmada desde el panel</b>\nmañana 14:00 · 4 pax · web");
  });
  it("cancelada, con quién la canceló", () => {
    expect(linea("cancelada", reserva({ estado: "cancelada" }), { quien: "cliente" })).toBe("🔴 <b>Cancelada por el cliente</b>\nmañana 14:00 · 4 pax · web");
    expect(linea("cancelada", reserva({ estado: "cancelada" }), { quien: "restaurante" })).toContain("Cancelada por el restaurante");
    expect(linea("cancelada", reserva({ estado: "cancelada" }))).toContain("🔴 <b>Cancelada</b>\n");
  });
  it("nunca lleva el nombre ni el teléfono del cliente; si la reserva se borró, lo dice", () => {
    const l = linea("nueva", reserva());
    expect(l).not.toMatch(/Ana|600/);
    expect(lineaPasoReserva({ ultimo: paso("cancelada", { quien: "cliente", estado: "cancelada" }), nueva: false }, null, AHORA, PANEL))
      .toBe("🔴 <b>Cancelada por el cliente</b>\nreserva borrada");
  });
  it("varios pasos de la misma reserva en la misma vuelta: un aviso con el último (y «reserva nueva»)", () => {
    const pasos = [paso("nueva"), paso("nueva", { reserva_id: "r2" }), paso("aceptada", { quien: "restaurante" })];
    const g = agruparPasos(pasos);
    expect(g.map((x) => [x.reserva_id, x.ultimo.evento, x.nueva, x.ids.length])).toEqual([["r1", "aceptada", true, 2], ["r2", "nueva", true, 1]]);
    expect(lineaPasoReserva(g[0], reserva({ estado: "verificada" }), AHORA, PANEL))
      .toBe("✅ <b>Aceptada</b> · reserva nueva, falta que confirme el cliente\nmañana 14:00 · 4 pax · web");
  });
});

describe("avisos-telegram · reservas en el resumen diario", () => {
  const proximas = [
    reserva({ id: "a", fecha: "2026-11-23", hora: "21:00:00", numero_comensales: 6, estado: "confirmada", canal: "manual" }),
    reserva({ id: "b", fecha: "2026-11-24", hora: "14:00:00", numero_comensales: 4, estado: "pendiente" }),
    reserva({ id: "c", fecha: "2026-11-24", hora: "14:30:00", numero_comensales: 2, estado: "verificada" }),
    reserva({ id: "d", fecha: "2026-11-27", hora: "15:30:00", numero_comensales: 6, estado: "pendiente" }),
    reserva({ id: "e", fecha: "2026-11-23", hora: "13:00:00", numero_comensales: 9, estado: "cancelada" }),
  ];
  it("hoy y mañana, y las peticiones por aceptar (de cualquier día) con el enlace para aceptarlas", () => {
    expect(bloqueReservas(proximas, AHORA, PANEL)).toEqual([
      "<b>📅 Reservas</b>\nHoy: 1 reserva (6 pax)\nMañana: 2 reservas (6 pax)",
      '<b>🟡 Peticiones por aceptar: 2</b> · <a href="https://panel.example/reservas?avisos=reservas">Aceptar</a>\n• mañana 14:00 · 4 pax\n• vie 27/11 15:30 · 6 pax',
    ]);
    expect(bloqueReservas([reserva({ fecha: "2026-11-30", estado: "confirmada" })], AHORA, null)).toEqual(["<b>📅 Reservas</b>\nHoy: sin reservas\nMañana: sin reservas"]);
    expect(bloqueReservas([], AHORA, PANEL)).toEqual([]);
  });
  it("el día del semanal va dentro del mismo mensaje y sin la línea de «por revisar» (no se repite)", () => {
    const revision = { tipo: "facturas_revision", titulo: "274 documentos", mensaje: null, referencia_tipo: "facturas_alerta", id: "rv", created_at: "2026-11-23T09:00:00Z", datos: { cuantos: 274, resumen: "avisos" } };
    const semanal = { facturas: { documentos: 413, importe: 689453 }, albaranes: { n: 3, proveedores: 2, importe: 812 } };
    const r = construirResumen([revision], AHORA, PANEL, { proximas, semanal });
    expect(r.conSemanal).toBe(true);
    expect(r.texto).toContain("<b>━━ La semana ━━</b>\n\n<b>📋 Facturas por verificar: 413</b>\n• 689.453 € en total");
    expect(r.texto).not.toContain("Documentos con avisos sin revisar");
    expect(r.texto).not.toContain("Ver avisos");
    expect(r.revision.avisos).toEqual({ n: 274, dia: "2026-11-23" });
    // Otro día, sin semanal: la línea de «por revisar» sí sale.
    expect(construirResumen([revision], AHORA, PANEL, { proximas }).texto).toContain("<b>📋 Documentos con avisos sin revisar: 274</b>");
  });
  it("un día sin avisos pero con reservas, el resumen sale igual (las reservas del día)", () => {
    const r = construirResumen([], AHORA, PANEL, { proximas });
    expect(r.texto.startsWith("<b>📊 Resumen · lunes 23/11</b>\n\n<b>📅 Reservas</b>\nHoy: 1 reserva (6 pax)")).toBe(true);
    expect(r.total).toBe(0);
  });
  it("lunes = 1 … domingo = 7 (Madrid)", () => {
    expect(diaSemanaMadrid(AHORA)).toBe(1);
    expect(diaSemanaMadrid(new Date("2026-11-22T22:30:00Z"))).toBe(7); // domingo 23:30 en Madrid
    expect(diaSemanaMadrid(new Date("2026-11-22T23:30:00Z"))).toBe(1); // lunes 00:30 en Madrid
  });
});

describe("avisos-telegram · HTML de Telegram", () => {
  it("va en HTML (negritas y enlaces cortos); si Telegram no lo acepta, el mismo texto en plano", () => {
    expect(cuerpoSendMessage("-100", "<b>Hola</b>")).toMatchObject({ parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    expect(cuerpoSendMessage("-100", "texto", false)).not.toHaveProperty("parse_mode");
    expect(aTextoPlano('🟡 <b>Petición</b> · 4 &amp; 5 pax · <a href="https://p.example/r?a=1&amp;b=2">Aceptar</a>'))
      .toBe("🟡 Petición · 4 & 5 pax · Aceptar: https://p.example/r?a=1&b=2");
  });
});
