import { describe, expect, it } from "vitest";
import {
  agruparEnMensajes, type Aviso, canalDeTipo, chatDe, construirResumen, cuerpoSendMessage, destinos, diaMadrid, enlacePanel, enSilencio, errorSaneado, esAccion,
  horaMadrid, LIMITE_TELEGRAM, lineaAviso, MAX_FALLOS, MAX_LINEA, mensajeAviso, pendientesDeEnvio, proveedorCorto, recortar, rutaPanel, silencioAhora,
  textoPrueba, tipoRegistro,
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

describe("avisos-telegram · un chat por canal", () => {
  it("reservas y solicitudes van a Reservas; todo lo demás, a Facturas y márgenes (igual que el SQL)", () => {
    expect(["reserva_nueva", "reserva_cancelada", "reserva_modificada", "solicitud_pendiente"].map(canalDeTipo)).toEqual(["reservas", "reservas", "reservas", "reservas"]);
    expect(["facturas_margen_bajo", "facturas_precio_sube", "peticion_urgente", "reservas_raras"].map(canalDeTipo)).toEqual(["facturas", "facturas", "facturas", "facturas"]);
  });
  it("cada canal usa su chat o, si no tiene, el general; los fallos técnicos NUNCA van al general", () => {
    const cfg = { chat_id: "-100", chat_reservas: " -200 ", chat_facturas: "", chat_resumenes: null, chat_fallos: null };
    expect(chatDe(cfg, "reservas")).toBe("-200");
    expect(chatDe(cfg, "facturas")).toBe("-100");
    expect(chatDe(cfg, "resumenes")).toBe("-100");
    expect(chatDe(cfg, "fallos")).toBeNull();
    expect(chatDe({ ...cfg, chat_fallos: "-900" }, "fallos")).toBe("-900");
    expect(chatDe({ chat_id: null }, "reservas")).toBeNull();
  });
  it("la prueba va una vez a cada chat distinto y dice qué llegará ahí", () => {
    const d = destinos({ chat_id: "-100", chat_reservas: "-200", chat_fallos: "-900" });
    expect(d).toEqual([
      { chat: "-200", canales: ["reservas"] },
      { chat: "-100", canales: ["facturas", "resumenes"] },
      { chat: "-900", canales: ["fallos"] },
    ]);
    expect(textoPrueba(["facturas", "resumenes"])).toBe("✅ Prueba de avisos de Casa Tomás. Aquí llegará: Facturas y márgenes y Resúmenes.");
    expect(destinos({ chat_id: null })).toEqual([]);
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
  it("un canal sin chat no recibe nada (y sus avisos esperan, no se descartan)", () => {
    const margen = aviso();
    expect(pendientesDeEnvio([margen], [], CFG, AHORA, { canales: new Set(["reservas"]) })).toEqual([]);
    expect(pendientesDeEnvio([margen], [], CFG, AHORA, { canales: new Set(["facturas"]) }).map((a) => a.id)).toEqual([margen.id]);
  });
});

describe("avisos-telegram · avisos de una línea", () => {
  it("una línea con emoji y, al final, el enlace con texto corto si hay PANEL_URL", () => {
    const a = aviso({ tipo: "facturas_precio_sube", titulo: "Sube el aceite", datos: { producto: "ACEITE OLIVA 5L", proveedor: "MAKRO, S.A.", precio: 36.8, precio_ref: 31.2, variacion_pct: 17.9, enlace: "?tab=compras&factura=12" } });
    expect(rutaPanel(a)).toBe("/facturas?tab=compras&factura=12");
    expect(mensajeAviso(a, "https://panel.example/")).toBe('📈 Aceite oliva 5l: +18 % (31,20 → 36,80 €) · Makro · <a href="https://panel.example/facturas?tab=compras&amp;factura=12">Abrir</a>');
    expect(mensajeAviso(a, null)).toBe("📈 Aceite oliva 5l: +18 % (31,20 → 36,80 €) · Makro");
    expect(enlacePanel("javascript:alert(1)", "/x")).toBeNull();
  });
  it("margen bajo de un plato: la cifra frente al límite y el precio que lo arregla, con «Aplicar el precio»", () => {
    const a = aviso({
      id: "0000-aa",
      datos: { canal: "plato", nombre: "Chuletón", valor: 41, limite: 35, producto: "Ternera", eur_antes: 18, eur: 21.5, enlace: "?tab=margenes&articulo=plato:1" },
    });
    const sug = { precio_actual: 22, precio_sugerido: 24.5 };
    expect(mensajeAviso(a, "https://panel.example", sug)).toBe('⚠️ Chuletón: coste 41 % (máx. 35 %) → súbelo a 24,50 € · <a href="https://panel.example/aplicar-precio/0000-aa">Aplicar precio</a>');
    // Ya aplicado o sin sugerencia: qué ha subido y enlace normal a Márgenes.
    const sin = mensajeAviso(a, "https://panel.example", null);
    expect(sin).toBe('⚠️ Chuletón: coste 41 % (máx. 35 %) · sube Ternera (18,00 → 21,50 €) · <a href="https://panel.example/facturas?tab=margenes&amp;articulo=plato:1">Abrir</a>');
    expect(mensajeAviso(a, "https://panel.example", { ...sug, aplicado: { precio: 24.5 } })).not.toContain("aplicar-precio");
  });
  it("margen bajo de un vino o al peso: veces que cobras lo que pagas", () => {
    expect(lineaAviso(aviso({ datos: { canal: "vino", nombre: "Ribera X", valor: 2.1, limite: 2.3, coste: 12, coste_antes: 10 } })))
      .toBe("Ribera X: cobras ×2,1 (mín. ×2,3) · coste 12,00 € (antes 10,00)");
    expect(lineaAviso(aviso({ datos: { canal: "peso", nombre: "Atún ijada", valor: 1.92, limite: 2, coste: 52, coste_antes: 48 } })))
      .toBe("Atún ijada: cobras ×1,92 (mín. ×2) · coste 52,00 €/kg (antes 48,00)");
    expect(lineaAviso(aviso({ datos: { canal: "tienda", nombre: "Rioja Y", valor: 1.2, limite: 1.5 } }), { sug: { precio_actual: 10, precio_sugerido: 12.5 } }))
      .toBe("Rioja Y: cobras ×1,2 (mín. ×1,5) en tienda → súbelo a 12,50 €");
  });
  it("cada aviso de Facturas en una línea con sus cifras (casos de producción)", () => {
    const l = (tipo: string, datos: Record<string, unknown>, titulo = "Título") => lineaAviso(aviso({ tipo, titulo, datos }));
    expect(l("facturas_precio_baja", { producto: "MICROMEZCLUM SUAVE 60G", proveedor: "Makro distribuidor mayorista S.A.", precio: 68.1667, precio_ref: 80.8333, variacion_pct: -15.7, medida: "kg" }))
      .toBe("Micromezclum suave 60g: −16 % (80,83 → 68,17 €/kg) · Makro distribuidor mayorista");
    expect(l("facturas_precio_mejor", { producto: "Nécora gallega hembra M", proveedor: "CETAREA ANGELMAR S.L.", proveedor_otro: "CASIMIRO PEREZ RODRIGUEZ", precio: 48.5, precio_otro: 30, medida: "kg", diferencia_pct: 38.1 }))
      .toBe("Nécora gallega hembra M: Casimiro Perez Rodriguez a 30,00 €/kg (tú 48,50, −38 %)");
    expect(l("facturas_familia_gasto", { familia: "Lácteos y huevos", variacion_pct: 45.8, valor: 3945.12, media: 2705.56 }))
      .toBe("Lácteos y huevos: +46 % este mes (~3.945 €, media 2.706 €)");
    expect(l("facturas_albaran_sin_factura", { proveedor: "Once de Enero Artesanos del Mar", albaranes: 1, importe: 294.25 }))
      .toBe("Once de Enero Artesanos del Mar: 1 albarán sin factura (294,25 €)");
    expect(l("facturas_proveedor_nuevo", { proveedor: "CASH ELCHE", importe: 324.03 })).toBe("Proveedor nuevo: Cash Elche (324,03 €)");
    expect(l("facturas_importe_inusual", { proveedor: "HERMANOS FERNANDEZ LOPEZ, SAU", importe: 985.92, veces: 4.7 }))
      .toBe("Hermanos Fernandez Lopez: factura de 985,92 € (×4,7 su media)");
    expect(l("facturas_precio_proveedor", { proveedor: "Frutas Pepe", productos: 4, variacion_pct: 12.4, impacto_mes: 38.2 }))
      .toBe("Frutas Pepe sube 4 productos (+12 % de media, ~38 €/mes)");
    expect(l("facturas_revision", { cuantos: 213, resumen: "avisos" })).toBe("213 documentos por revisar");
    // Sin datos para una línea propia: el título.
    expect(l("facturas_abreviatura", { abreviatura: "mc" }, "«MC» parece Metro Chef. ¿Confirmar?")).toBe("«MC» parece Metro Chef. ¿Confirmar?");
    expect(l("facturas_precio_sube", {}, "Berberecho sube un 10 % en CASIMIRO")).toBe("Berberecho sube un 10 % en CASIMIRO");
  });
  it("todos los avisos sueltos son UNA línea y el texto nunca pasa de MAX_LINEA; el HTML va escapado", () => {
    const tipos = ["reserva_nueva", "reserva_cancelada", "solicitud_pendiente", "facturas_precio_sube", "facturas_revision", "sistema", "facturas_margen_bajo", "peticion_urgente"];
    for (const tipo of tipos) {
      const m = mensajeAviso(aviso({ tipo, titulo: "Algo ha pasado con 3 cosas ".repeat(20), mensaje: "Una frase larga. Y una segunda." }), "https://panel.example");
      expect(m).not.toContain("\n");
      expect(m.replace(/ · <a .*$/, "").length).toBeLessThanOrEqual(MAX_LINEA + 3); // + emoji y espacio
    }
    expect(mensajeAviso(aviso({ tipo: "sistema", titulo: "Gin & Tonic <b>gratis</b>" }), null)).toBe("ℹ️ Gin &amp; Tonic &lt;b&gt;gratis&lt;/b&gt;");
  });
  it("las reservas van sin enlace", () => {
    expect(mensajeAviso(aviso({ tipo: "reserva_nueva", titulo: "Reserva nueva", mensaje: null }), "https://panel.example")).toBe("🟢 Reserva");
  });
  it("proveedor corto: sin forma jurídica y sin gritar", () => {
    expect(proveedorCorto("Distribuciones Gastronómicas Nicolás y Valero, S.R.L.")).toBe("Distribuciones Gastronómicas…");
    expect(proveedorCorto("CASIMIRO PEREZ RODRIGUEZ")).toBe("Casimiro Perez Rodriguez");
    expect(proveedorCorto("Makro distribuidor mayorista S.A.")).toBe("Makro distribuidor mayorista");
    expect(proveedorCorto("Vinos Lisa")).toBe("Vinos Lisa");
  });
  it("respeta el límite de 4.096 caracteres", () => {
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
  it("acciones válidas y su tipo en el registro (el de fallos es «fallo»)", () => {
    expect(["pendientes", "resumen", "probar", "fallos", "semanal", "informes"].every(esAccion)).toBe(true);
    expect(esAccion("borrar")).toBe(false);
    expect(["pendientes", "resumen", "probar", "fallos", "semanal"].map((a) => tipoRegistro(a as never))).toEqual(["pendientes", "resumen", "prueba", "fallo", "semanal"]);
  });
});

describe("avisos-telegram · resumen diario", () => {
  const CAB = "<b>📊 Resumen · miércoles 11/11</b>";
  it("una sección por tipo con el número y los casos en lista; los avisos de reservas del panel no salen (van por sus pasos)", () => {
    const avisos = [
      aviso({ tipo: "reserva_nueva", titulo: "Reserva nueva", mensaje: "Ana Pérez · 12/11 21:00 · 4 pers. · web", created_at: "2026-11-11T08:00:00Z" }),
      aviso({ datos: { canal: "vino", nombre: "Ribera X", valor: 2.1, limite: 2.3 } }),
      aviso({ tipo: "reserva_sin_asignar", titulo: "No sale" }),
      aviso({ tipo: "ia_modelo_nuevo", titulo: "Tampoco" }),
      aviso({ titulo: "Viejo", created_at: "2026-11-09T09:00:00Z" }),
    ];
    const { texto, total } = construirResumen(avisos, AHORA, "https://panel.example");
    expect(total).toBe(1);
    expect(texto).toBe(`${CAB}\n\n<b>⚠️ Margen bajo: 1</b>\n• Ribera X ×2,1\n\n<a href="https://panel.example/avisos">Ver avisos</a>`);
    expect(texto).not.toMatch(/Ana|No sale|Tampoco|Viejo/);
  });
  it("los 2 casos más importantes y «y N más»", () => {
    const avisos = [5, 40, 12, 3, 25].map((impacto, i) =>
      aviso({ tipo: "facturas_precio_sube", datos: { producto: `Producto ${i}`, precio: 11, precio_ref: 10, variacion_pct: 10, impacto_mes: impacto } }));
    expect(construirResumen(avisos, AHORA).texto).toContain("<b>📈 Suben de precio: 5</b>\n• Producto 1 +10 %\n• Producto 4 +10 %\n• y 3 más");
  });
  it("no repite lo que ya llegó al momento", () => {
    const ya = aviso();
    const no = aviso({ tipo: "facturas_albaran_sin_factura", datos: { proveedor: "Makro", albaranes: 2, importe: 340 } });
    const r = construirResumen([ya, no], AHORA, null, { enviados: new Set([ya.id]) });
    expect(r.total).toBe(1);
    expect(r.texto).toBe(`${CAB}\n\n<b>🧾 Albaranes sin factura: 1</b>\n• Makro 340 €`);
    expect(construirResumen([ya], AHORA, null, { enviados: new Set([ya.id]) }).texto).toBe("");
  });
  it("sin avisos ni reservas no manda nada (texto vacío)", () => {
    expect(construirResumen([], AHORA)).toMatchObject({ texto: "", total: 0, conSemanal: false });
  });
  it("sin nombres repetidos: «• No imprime…» bajo «Peticiones urgentes», no «Petición urgente: No imprime…»", () => {
    const t2 = construirResumen([aviso({ tipo: "peticion_urgente", titulo: "Petición urgente: No imprime la comanda de cocina" })], AHORA).texto;
    expect(t2).toContain("<b>🚨 Peticiones urgentes: 1</b>\n• No imprime la comanda de cocina");
  });
  it("nunca pasa de 4.096 aunque haya muchos tipos y títulos largos", () => {
    const tipos = Array.from({ length: 60 }, (_, i) => `tipo_raro_${i}`);
    const avisos = tipos.flatMap((t) => Array.from({ length: 3 }, () => aviso({ tipo: t, titulo: "z ".repeat(200) })));
    const { texto } = construirResumen(avisos, AHORA, "https://panel.example");
    expect(texto.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    expect(texto).toContain("\n…y más en el panel\n\n");
    expect(texto.match(/<b>🔔 tipo raro/g)!.length).toBeGreaterThan(10); // mete las líneas que caben, no tira el bloque
    expect(texto.endsWith('<a href="https://panel.example/avisos">Ver avisos</a>')).toBe(true);
  });
});
