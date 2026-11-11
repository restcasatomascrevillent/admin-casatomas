import { describe, expect, it } from "vitest";
import {
  agruparEnMensajes, type Aviso, construirResumen, cuerpoSendMessage, diaMadrid, enlacePanel, enSilencio, errorSaneado, esAccion, fraseAviso, horaMadrid,
  LIMITE_TELEGRAM, MAX_FALLOS, mensajeAviso, pendientesDeEnvio, recortar, rutaPanel, silencioAhora,
} from "../logica";

const AHORA = new Date("2026-11-11T10:00:00Z"); // 11:00 en Madrid

let n = 0;
const aviso = (p: Partial<Aviso> = {}): Aviso => ({
  id: `a${++n}`,
  tipo: "facturas_margen_bajo",
  titulo: "Margen bajo en Ribera X",
  mensaje: "El vino ha bajado a 2,1×",
  referencia_tipo: "facturas_alerta",
  created_at: new Date(AHORA.getTime() - 10 * 60_000).toISOString(),
  datos: {},
  ...p,
});

const CFG = { tipos_al_momento: ["facturas_margen_bajo", "facturas_precio_sube"], activo_desde: "2026-11-10T00:00:00Z" };

describe("avisos-telegram · silencio nocturno", () => {
  it("23–8 cruza la medianoche", () => {
    expect([23, 0, 3, 7].every((h) => enSilencio(h, 23, 8))).toBe(true);
    expect([8, 12, 22].some((h) => enSilencio(h, 23, 8))).toBe(false);
  });
  it("tramo dentro del día y desde = hasta (sin silencio)", () => {
    expect(enSilencio(14, 14, 16)).toBe(true);
    expect(enSilencio(16, 14, 16)).toBe(false);
    expect(enSilencio(5, 5, 5)).toBe(false);
  });
  it("usa la hora de Madrid (invierno UTC+1, verano UTC+2)", () => {
    expect(horaMadrid(new Date("2026-11-11T22:30:00Z"))).toBe(23);
    expect(horaMadrid(new Date("2026-07-01T21:30:00Z"))).toBe(23);
    expect(diaMadrid(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-12");
    const cfg = { silencio_activo: true, silencio_desde: 23, silencio_hasta: 8 };
    expect(silencioAhora(cfg, new Date("2026-11-11T22:30:00Z"))).toBe(true);
    expect(silencioAhora(cfg, new Date("2026-11-11T07:00:00Z"))).toBe(false); // 08:00 en Madrid
    expect(silencioAhora({ ...cfg, silencio_activo: false }, new Date("2026-11-11T22:30:00Z"))).toBe(false);
  });
});

describe("avisos-telegram · pendientes (no reenviar)", () => {
  it("solo tipos marcados, recientes, posteriores a la activación, con campana y sin excluir", () => {
    const bueno = aviso();
    const lista = [
      bueno,
      aviso({ tipo: "reserva_nueva" }),
      aviso({ created_at: "2026-11-09T12:00:00Z" }), // anterior a la activación
      aviso({ datos: { campana: false } }),
      aviso({ caduca_en: "2026-11-11T09:00:00Z" }),
    ];
    expect(pendientesDeEnvio(lista, [], CFG, AHORA).map((a) => a.id)).toEqual([bueno.id]);
  });
  it("lo ya enviado no se vuelve a mandar; los fallos se reintentan hasta MAX_FALLOS", () => {
    const a = aviso();
    const b = aviso({ tipo: "facturas_precio_sube" });
    const c = aviso();
    const envios = [
      { aviso_id: a.id, ok: true },
      ...Array.from({ length: MAX_FALLOS }, () => ({ aviso_id: b.id, ok: false })),
      { aviso_id: c.id, ok: false },
    ];
    expect(pendientesDeEnvio([a, b, c], envios, CFG, AHORA).map((x) => x.id)).toEqual([c.id]);
  });
  it("sin activo_desde no manda nada viejo; ordena del más antiguo al más nuevo", () => {
    expect(pendientesDeEnvio([aviso()], [], { ...CFG, activo_desde: null }, AHORA)).toEqual([]);
    const nuevo = aviso({ created_at: "2026-11-11T09:58:00Z" });
    const viejo = aviso({ created_at: "2026-11-11T09:00:00Z" });
    expect(pendientesDeEnvio([nuevo, viejo], [], CFG, AHORA).map((x) => x.id)).toEqual([viejo.id, nuevo.id]);
  });
});

describe("avisos-telegram · mensajes", () => {
  it("usa texto_telegram y, si no hay, «Título: mensaje»", () => {
    expect(fraseAviso(aviso({ datos: { texto_telegram: "  El vino ha bajado.\n Revisa. " } }))).toBe("El vino ha bajado. Revisa.");
    expect(fraseAviso(aviso({ datos: null }))).toBe("Margen bajo en Ribera X: El vino ha bajado a 2,1×");
    expect(fraseAviso(aviso({ mensaje: null, datos: null }))).toBe("Margen bajo en Ribera X");
  });
  it("enlace al panel solo con PANEL_URL válida", () => {
    const a = aviso({ datos: { texto_telegram: "Sube.", enlace: "?tab=compras&factura=12" } });
    expect(rutaPanel(a)).toBe("/facturas?tab=compras&factura=12");
    expect(rutaPanel(aviso({ tipo: "reserva_nueva", referencia_tipo: "reserva" }))).toBe("/reservas?tab=reservas");
    expect(mensajeAviso(a, "https://panel.example/")).toBe("Margen bajo\nSube.\nhttps://panel.example/facturas?tab=compras&factura=12");
    expect(mensajeAviso(a, null)).toBe("Margen bajo\nSube.");
    expect(enlacePanel("javascript:alert(1)", "/x")).toBeNull();
  });
  it("respeta el límite de 4.096 caracteres", () => {
    const largo = aviso({ datos: { texto_telegram: "x".repeat(10_000) } });
    expect(mensajeAviso(largo, "https://panel.example").length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    expect(recortar("abcdef", 4)).toBe("abc…");
    expect((cuerpoSendMessage("-100", "y".repeat(5000)).text as string).length).toBe(LIMITE_TELEGRAM);
  });
  it("agrupa varios avisos en mensajes de ≤ 4.096 y sabe qué aviso va en cada uno", () => {
    const textos = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(1500));
    const m = agruparEnMensajes(textos);
    expect(m.map((x) => x.indices)).toEqual([[0, 1], [2, 3], [4]]);
    expect(m.every((x) => x.texto.length <= LIMITE_TELEGRAM)).toBe(true);
  });
  it("el error nunca lleva el token", () => {
    expect(errorSaneado("fallo en https://api.telegram.org/bot123456:ABC-def_g/sendMessage")).not.toContain("123456:ABC");
  });
  it("acciones válidas", () => {
    expect(["pendientes", "resumen", "probar"].every(esAccion)).toBe(true);
    expect(esAccion("borrar")).toBe(false);
  });
});

describe("avisos-telegram · resumen diario", () => {
  it("agrupa por tipo con número y frases, el más numeroso primero", () => {
    const avisos = [
      aviso({ tipo: "reserva_nueva", titulo: "Reserva de Ana", mensaje: "4 personas", created_at: "2026-11-11T08:00:00Z" }),
      aviso({ tipo: "reserva_nueva", titulo: "Reserva de Luis", mensaje: null, created_at: "2026-11-11T09:00:00Z" }),
      aviso({ datos: { texto_telegram: "El vino X ha bajado a 2,1×." } }),
      aviso({ tipo: "reserva_sin_asignar", titulo: "No sale" }),
      aviso({ tipo: "ia_modelo_nuevo", titulo: "Tampoco" }),
      aviso({ titulo: "Viejo", created_at: "2026-11-09T09:00:00Z" }),
    ];
    const { texto, total } = construirResumen(avisos, AHORA, "https://panel.example");
    expect(total).toBe(3);
    expect(texto).toContain("Últimas 24 h: 3 avisos.");
    expect(texto.indexOf("Reservas nuevas (2)")).toBeLessThan(texto.indexOf("Margen bajo (1)"));
    expect(texto).toContain("• Reserva de Luis");
    expect(texto).toContain("• El vino X ha bajado a 2,1×.");
    expect(texto).not.toContain("No sale");
    expect(texto).not.toContain("Tampoco");
    expect(texto).not.toContain("Viejo");
    expect(texto).toContain("https://panel.example/avisos");
  });
  it("como mucho 4 frases por tipo y «…y N más»", () => {
    const avisos = Array.from({ length: 7 }, (_, i) => aviso({ tipo: "facturas_precio_sube", datos: { texto_telegram: `Sube ${i}` } }));
    const { texto } = construirResumen(avisos, AHORA);
    expect(texto.match(/^• /gm)?.length).toBe(4);
    expect(texto).toContain("…y 3 más.");
  });
  it("sin avisos lo dice", () => {
    expect(construirResumen([], AHORA).texto).toContain("Sin avisos en las últimas 24 h.");
  });
  it("nunca pasa de 4.096 aunque haya muchos tipos y textos largos", () => {
    const tipos = ["facturas_precio_sube", "facturas_margen_bajo", "reserva_nueva", "facturas_revision", "facturas_proveedor_nuevo", "facturas_importe_inusual", "facturas_precio_baja", "facturas_precio_mejor", "reserva_cancelada", "subida_precio", "facturas_familia_gasto", "facturas_precio_pactado"];
    const avisos = tipos.flatMap((t) => Array.from({ length: 5 }, () => aviso({ tipo: t, datos: { texto_telegram: "z".repeat(390) } })));
    const { texto } = construirResumen(avisos, AHORA, "https://panel.example");
    expect(texto.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    expect(texto).toContain("No cabe todo");
    expect(texto).toContain("https://panel.example/avisos");
    const enorme = construirResumen([aviso({ datos: { texto_telegram: "w".repeat(9000) } })], AHORA);
    expect(enorme.texto.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
  });
});
