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
  it("frase corta: la primera frase de texto_telegram o del mensaje", () => {
    expect(fraseAviso(aviso({ datos: { texto_telegram: "  El vino ha bajado.\n Revisa. " } }))).toBe("El vino ha bajado.");
    expect(fraseAviso(aviso({ datos: null }))).toBe("El vino ha bajado a 2,1×");
    expect(fraseAviso(aviso({ mensaje: null, datos: null }))).toBe("Margen bajo en Ribera X");
    expect(fraseAviso(aviso({ tipo: "facturas_precio_sube", mensaje: "Bogavante ha subido un 12 %: de 25,00 a 28,00 €/kg. Con lo que compras, son unos 20 € más al mes." })))
      .toBe("Bogavante ha subido un 12 %: de 25,00 a 28,00 €/kg.");
  });
  it("enlace al panel solo con PANEL_URL válida", () => {
    const a = aviso({ tipo: "facturas_precio_sube", titulo: "Sube el aceite", datos: { texto_telegram: "Sube.", enlace: "?tab=compras&factura=12" } });
    expect(rutaPanel(a)).toBe("/facturas?tab=compras&factura=12");
    expect(rutaPanel(aviso({ tipo: "reserva_nueva", referencia_tipo: "reserva" }))).toBe("/reservas?tab=reservas");
    expect(mensajeAviso(a, "https://panel.example/")).toBe(
      "Sube el aceite\nSube.\nQué hacer: mira si toca subir la carta o pedir otro precio.\nVer: https://panel.example/facturas?tab=compras&factura=12",
    );
    expect(mensajeAviso(a, null)).toBe("Sube el aceite\nSube.\nQué hacer: mira si toca subir la carta o pedir otro precio.");
    expect(enlacePanel("javascript:alert(1)", "/x")).toBeNull();
  });
  it("margen bajo de un plato: 4 líneas con números, precio sugerido y enlace para aplicarlo", () => {
    const a = aviso({
      id: "0000-aa",
      datos: { canal: "plato", nombre: "Chuletón", valor: 41, limite: 35, producto: "Ternera", eur_antes: 18, eur: 21.5, enlace: "?tab=margenes&articulo=plato:1" },
    });
    const sug = { precio_actual: 22, precio_sugerido: 24.5 };
    const m = mensajeAviso(a, "https://panel.example", sug);
    expect(m).toBe(
      "Margen bajo: Chuletón\n" +
        "Los ingredientes ya son el 41 % de lo que cobras (máximo 35 %). Sube Ternera: de 18,00 € a 21,50 €.\n" +
        "Qué hacer: sube la carta de 22,00 € a 24,50 € (con IVA).\n" +
        "Aplicar el precio: https://panel.example/aplicar-precio/0000-aa",
    );
    expect(m.split("\n").length).toBeLessThanOrEqual(4);
    // Ya aplicado o sin sugerencia: enlace normal a Márgenes.
    expect(mensajeAviso(a, "https://panel.example", { ...sug, aplicado: { precio: 24.5 } })).toContain("Ver: https://panel.example/facturas?tab=margenes");
    expect(mensajeAviso(a, "https://panel.example", null)).toContain("Qué hacer: revisa el precio en Facturas › Márgenes.");
  });
  it("margen bajo de un vino: veces que cobras lo que pagas", () => {
    const a = aviso({ datos: { canal: "vino", nombre: "Ribera X", valor: 2.1, limite: 2.3, coste: 12, coste_antes: 10 } });
    expect(fraseAviso(a)).toBe("Cobras 2,1 veces lo que pagas (mínimo 2,3). La botella te cuesta 12,00 € (antes 10,00 €).");
  });
  it("todos los avisos sueltos tienen entre 2 y 4 líneas", () => {
    const tipos = ["reserva_nueva", "reserva_cancelada", "solicitud_pendiente", "facturas_precio_sube", "facturas_revision", "sistema", "facturas_margen_bajo"];
    for (const tipo of tipos) {
      const l = mensajeAviso(aviso({ tipo, mensaje: "Algo ha pasado con 3 cosas. Y una segunda frase larga que no debe salir." }), "https://panel.example").split("\n");
      expect(l.length).toBeGreaterThanOrEqual(2);
      expect(l.length).toBeLessThanOrEqual(4);
      expect(l.join("\n")).not.toContain("segunda frase");
    }
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
    expect(texto).toContain("• 4 personas");
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
