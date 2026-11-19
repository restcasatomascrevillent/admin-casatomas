/**
 * Seguimientos sobre una tarifa adjunta (19/11/2026). Prueba del dueño en la demo con su tarifa de 2.669
 * artículos y el micrófono:
 *   1. «Es un proveedor nuevo y no tengo descuento, ¿hay algún artículo que compre que me salga más barato?»
 *   2. «Quiero que me digas los cinco artículos que más me interesan.»
 *   3. «Ponme solo los precios de los cinco artículos que más me interesan, con IVA, sin IVA y a cuánto lo compro yo.»
 * La 2 y la 3 repetían el resumen y la tabla de 30 filas, y la 3 decía «no dispongo de los precios con IVA».
 * Ahora la tabla sale solo en la primera comparación (o si se pide verla o cambia el descuento) y el modelo
 * recibe el precio por envase, con y sin IVA, y lo que pagó la última vez. Las cifras de las líneas son las que
 * devuelve comparar_presupuesto_agente (20261212800000) con esa tarifa en la demo.
 *
 * Además, los tres tipos de archivo (Excel, PDF y foto) llegan al mismo punto: guardan las líneas y preguntan el
 * descuento, sin comparar todavía.
 */
import { describe, expect, it, vi } from "vitest";
import {
  claveComparacion,
  comparacionGuardada,
  comparacionPreviaDelHilo,
  ejecutarConversacion,
  VIGENCIA_COMPARACION_MS,
  MARCA_ADJUNTO_PRESUPUESTO,
  prepararPresupuesto,
  type EstadoUso,
  type TurnoHistorial,
} from "../bucle.ts";
import { detalleParaModelo, mostrarTablaPresupuesto, pideTablaCompleta, tablaPresupuesto } from "../tabla.ts";
import { procesarPresupuesto } from "../adjuntar.ts";

const ID = "20943841-c50d-46c3-af79-ddf36cd890c4";
const ARCHIVO = "Artículos de lista de precio - 2026-11-16T091755.919.xlsx";
const PREGUNTA_1 = "Es un proveedor nuevo y no tengo descuento, hay algun articulo que compre que me salga mas barato?";
const PREGUNTA_2 = "Quiero que me digas los cinco artículos que más me interesan.";
const PREGUNTA_3 = "Ponme solo los precios de los cinco artículos que más me interesan, con IVA, sin IVA y a cuánto lo compro yo.";
const NINGUNO = { proveedor: null, descuento_tipo: "ninguno", descuento_valor: null };

const linea = (producto: string, coincide: string, unidad: string, oferta: number, ultimo: number, proveedor: string, dif: number, ahorro: number,
  envase: string, pe: { tarifa: number; tarifa_con_iva: number; ultimo: number; ultimo_con_iva: number }) => ({
  producto, coincide_con: coincide, unidad, oferta, ultimo: { precio: ultimo, proveedor, fecha: "2026-10-20" }, dif_pct: dif,
  ahorro_anual: ahorro, veredicto: "Interesa", confianza: "alta", envase, unidad_tarifa: "ud", iva_pct: 21, precio_envase: pe,
});

/** Lo que devuelve comparar_presupuesto_agente (las 5 primeras, reales, y una de cada otra sección). */
const RESULTADO = {
  proveedor: null,
  archivo: ARCHIVO,
  descuento: { tipo: "ninguno", pct: 0 },
  resumen: { lineas_total: 2669, lineas_que_compras: 368, interesa: 43, revisar: 293, no_interesa: 32, productos_interesa: 36, ahorro_anual_interesa: 1561.1 },
  lineas: [
    linea("V.VIÑA ARANA GRAN RESERVA 75CL 14,5º C6", "Viña Arana Gran Reserva 75 cl", "l", 29.03, 32.85, "Distribuciones Guerrero", -11.6, 243.64, "75 cl",
      { tarifa: 21.77, tarifa_con_iva: 26.34, ultimo: 24.64, ultimo_con_iva: 29.81 }),
    linea("V.CARMELO RODERO 9 MESES 75CL 15º C12", "Carmelo Rodero Crianza 75 cl", "l", 14.67, 18.73, "JULIÁN FERNÁNDEZ", -21.7, 164.7, "75 cl",
      { tarifa: 11, tarifa_con_iva: 13.31, ultimo: 14.05, ultimo_con_iva: 17 }),
    linea("W.JOHNNIE WALKER E/N 70CL 40º C6 ROSCA", "Johnnie Walker Black 70 cl", "l", 21.14, 22.76, "VINOS Y LICORES GARCÍA", -7.1, 158.2, "70 cl",
      { tarifa: 14.8, tarifa_con_iva: 17.91, ultimo: 15.93, ultimo_con_iva: 19.28 }),
    linea("T.JOSE CUERVO ESPECIAL REPOSADO 70CL 38º C12 ROSCA", "Cuervo Especial Reposado 70 cl", "l", 12.61, 15.57, "VINOS Y LICORES GARCÍA", -19, 120.06, "70 cl",
      { tarifa: 8.83, tarifa_con_iva: 10.68, ultimo: 10.9, ultimo_con_iva: 13.19 }),
    linea("V.MACAN COSECHA 75CL 14º C6 CAJA MADERA", "Macán 75 cl", "ud", 47.5, 48.9, "NEGOCIANTS S.L.U.", -2.9, 117.6, "75 cl",
      { tarifa: 47.5, tarifa_con_iva: 57.48, ultimo: 48.9, ultimo_con_iva: 59.17 }),
    linea("W.JOHNNIE WALKER E/ROJA 70CL 40º C6 ROSCA", "Johnnie Walker Red 70 cl", "ud", 8.55, 10.26, "DISTRIBUCIONES DIEGO", -16.7, 107.73, "70 cl",
      { tarifa: 8.55, tarifa_con_iva: 10.35, ultimo: 10.26, ultimo_con_iva: 12.41 }),
    { producto: "GIN.BEEFEATER 1L 40º C6", coincide_con: "Beefeater 70 cl", veredicto: "Revisar", motivo: "envase_distinto", nota: "la tarifa trae 1 l y lo que compras trae 70 cl",
      envase: "1 l", unidad_tarifa: "ud", iva_pct: 21, precio_envase: { tarifa: 15.9, tarifa_con_iva: 19.24 } },
    { producto: "CHA.MOET BRUT IMPERIAL 75CL", coincide_con: "Moët Brut Impérial 75 cl", unidad: "ud", oferta: 41, ultimo: { precio: 37.5, proveedor: "Prov B" }, dif_pct: 9.3,
      veredicto: "No interesa", envase: "75 cl", unidad_tarifa: "ud", iva_pct: 21, precio_envase: { tarifa: 41, tarifa_con_iva: 49.61, ultimo: 37.5, ultimo_con_iva: 45.38 } },
  ],
};

/** La conversación del dueño tal como queda guardada (con el contexto de herramientas de cada respuesta). */
const HILO: TurnoHistorial[] = [
  { role: "user", content: `${MARCA_ADJUNTO_PRESUPUESTO}: ${ARCHIVO}` },
  { role: "assistant", content: `He leído la tarifa «${ARCHIVO}»: 2669 artículos. ¿De qué proveedor es y te aplica algún descuento?`, herramientas: [] },
  { role: "user", content: PREGUNTA_1 },
  { role: "assistant", content: "**Sí: 36 productos te interesan**, con un ahorro estimado de 1.561,10 € al año.\n\n### Interesa: los 30 que más ahorran (de 36)\n| … |",
    herramientas: [{ nombre: "comparar_presupuesto", argumentos: NINGUNO }] },
];

describe("¿cuándo va la tabla debajo de la respuesta?", () => {
  it("las tres preguntas del dueño: tabla en la primera, no en los seguimientos", () => {
    expect(mostrarTablaPresupuesto(PREGUNTA_1, NINGUNO, null)).toBe(true);
    expect(mostrarTablaPresupuesto(PREGUNTA_2, NINGUNO, NINGUNO)).toBe(false);
    expect(mostrarTablaPresupuesto(PREGUNTA_3, NINGUNO, NINGUNO)).toBe(false);
  });

  it("vuelve si se pide verla o si cambia el descuento", () => {
    expect(mostrarTablaPresupuesto("enséñame los de Revisar", NINGUNO, NINGUNO)).toBe(true);
    expect(mostrarTablaPresupuesto("ver los que no interesan", NINGUNO, NINGUNO)).toBe(true);
    expect(mostrarTablaPresupuesto("vuelve a enseñarme la tabla", NINGUNO, NINGUNO)).toBe(true);
    expect(mostrarTablaPresupuesto("ponme la comparativa completa", NINGUNO, NINGUNO)).toBe(true);
    expect(mostrarTablaPresupuesto("y si me hace un 5 %?", { descuento_tipo: "porcentaje", descuento_valor: 5 }, NINGUNO)).toBe(true);
    // Mismo descuento escrito de otra forma: no cambia nada.
    expect(mostrarTablaPresupuesto("¿y el Beefeater?", { descuento_tipo: "ninguno", descuento_valor: 0 }, NINGUNO)).toBe(false);
  });

  it("«en una tabla los cinco…» es una tabla corta del modelo, no la comparativa entera", () => {
    expect(pideTablaCompleta("ponme en una tabla los 5 que más ahorran")).toBe(false);
    expect(pideTablaCompleta("hazme una lista solo con los vinos")).toBe(false);
    expect(pideTablaCompleta("enséñame una tabla completa")).toBe(true);
    expect(pideTablaCompleta("quiero ver todos los que me interesan")).toBe(true);
    expect(pideTablaCompleta("la tabla con un 5 % de descuento")).toBe(false);
  });

  it("la comparación previa sale del hilo; un adjunto nuevo la olvida", () => {
    expect(comparacionPreviaDelHilo(HILO)).toEqual(NINGUNO);
    expect(comparacionPreviaDelHilo(HILO.slice(0, 2))).toBeNull();
    expect(comparacionPreviaDelHilo([...HILO, { role: "user", content: `${MARCA_ADJUNTO_PRESUPUESTO}: otra.pdf` }])).toBeNull();
    // Una comparación fallida (sin descuento) no cuenta.
    expect(comparacionPreviaDelHilo([...HILO.slice(0, 3), { role: "assistant", content: "¿Te aplica descuento?", herramientas: [{ nombre: "comparar_presupuesto", argumentos: {}, error: "Falta el parametro" }] }])).toBeNull();
  });
});

describe("lo que recibe el modelo en un seguimiento", () => {
  it("las que interesan por ahorro, con precio por botella con y sin IVA y lo que pagó", () => {
    const d = detalleParaModelo(RESULTADO, PREGUNTA_3);
    expect(d.interesa).toHaveLength(6);
    expect(d.interesa[0]).toMatchObject({
      puesto: 1, producto: "V.VIÑA ARANA GRAN RESERVA 75CL 14,5º C6", envase: "75 cl",
      sin_iva: 21.77, iva_pct: 21, con_iva: 26.34, tu_precio_sin_iva: 24.64, tu_precio_con_iva: 29.81, ahorro_anual: 243.64,
    });
    expect(d.interesa[4]).toMatchObject({ puesto: 5, es: "Macán 75 cl", sin_iva: 47.5, con_iva: 57.48, tu_precio_sin_iva: 48.9 });
    expect(d.tabla).toMatch(/NO se añade/);
    expect(d.como_responder).toMatch(/SOLO lo que pregunta/);
    expect(d.como_responder).toMatch(/exactamente N/);
    expect(d.como_responder).toMatch(/NO repitas el resumen/);
    expect(JSON.stringify(d)).not.toMatch(/2-4 lineas/);
  });

  it("si nombra un artículo que está en Revisar o No interesa, también se lo pasa", () => {
    const d = detalleParaModelo(RESULTADO, "¿Y el Beefeater a cuánto sale con IVA?");
    expect(d.otras_que_nombra).toHaveLength(1);
    expect(d.otras_que_nombra[0]).toMatchObject({ producto: "GIN.BEEFEATER 1L 40º C6", veredicto: "Revisar", con_iva: 19.24 });
    expect(d.otras_que_nombra[0].motivo).toMatch(/1 l y lo que compras trae 70 cl/);
    expect(detalleParaModelo(RESULTADO, PREGUNTA_2).otras_que_nombra).toBeUndefined();
  });

  it("prepararPresupuesto sin tabla: el detalle; con tabla: el resumen de siempre", () => {
    const sin = prepararPresupuesto(RESULTADO, "interesa", { conTabla: false, pregunta: PREGUNTA_2 });
    expect(sin?.tabla).toBeNull();
    expect((sin?.paraModelo as { interesa: unknown[] }).interesa).toHaveLength(6);
    const con = prepararPresupuesto(RESULTADO, "interesa");
    expect(con?.tabla).toContain("### Interesa");
    expect(JSON.stringify(con?.paraModelo)).toMatch(/2-4 lineas/);
  });
});

describe("la tabla da el precio por botella o envase", () => {
  it("«21,77 € · 75 cl» frente a «24,64 €», no €/l", () => {
    const t = tablaPresupuesto(RESULTADO);
    expect(t).toContain("| V.VIÑA ARANA GRAN RESERVA 75CL 14,5º C6 | 21,77 € · 75 cl (-11,6 %) | 24,64 € (Distribuciones Gu…) | 243,64 € |");
    expect(t).not.toContain("29,03 €/l");
    expect(tablaPresupuesto(RESULTADO, "no_interesa")).toContain("| 41,00 € · 75 cl | 37,50 € (Prov B) |");
  });

  it("sin el último precio por envase, la fila sigue en €/l (nunca mezcla botella con litro)", () => {
    const l = { ...RESULTADO.lineas[0], precio_envase: { tarifa: 21.77, tarifa_con_iva: 26.34 } };
    const t = tablaPresupuesto({ ...RESULTADO, lineas: [l] });
    expect(t).toContain("| 29,03 €/l (-11,6 %) | 32,85 €/l (Distribuciones Gu…) |");
  });
});

// ─── La conversación entera con un OpenAI de mentira ────────────────────────

function acumulador(modelo: string) {
  return { modelo, llamadas: 0, sumar() { this.llamadas++; }, marcarError() { /* nada */ } };
}
function estado(modelo: string): EstadoUso {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { usosChat: [acumulador(modelo) as any], usoEmbed: acumulador("emb") as any, nuevoAcumuladorChat: (m) => acumulador(m) as any };
}
function supabaseFalso() {
  const rpcs: { fn: string; args: unknown }[] = [];
  return {
    rpcs,
    rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      if (fn === "comparar_presupuesto_agente") return Promise.resolve({ data: RESULTADO, error: null });
      if (fn === "asociar_pregunta_agente" || fn === "meses_compras_incompletos") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from() { throw new Error("no se espera lectura de tablas"); },
  };
}
function openaiFalso(textoFinal: string) {
  const cuerpos: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
  const respuestas = [
    { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "comparar_presupuesto", arguments: JSON.stringify(NINGUNO) } }] } }] },
    { choices: [{ message: { role: "assistant", content: textoFinal } }] },
  ];
  const f = (async (_u: string, init: RequestInit) => {
    cuerpos.push(JSON.parse(String(init.body)));
    const r = respuestas.shift();
    if (!r) throw new Error("llamada de más a OpenAI");
    return new Response(JSON.stringify({ ...r, usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, cuerpos };
}
const PRESUPUESTO = { id: ID, proveedor: null, archivo: ARCHIVO, lineas: 2669 };

describe("la conversación del dueño, de punta a punta", () => {
  it("pregunta 3: contesta solo los precios, sin resumen ni tabla, con IVA del producto", async () => {
    const ai = openaiFalso("| Artículo | Sin IVA | Con IVA | Tú pagas |\n|---|---:|---:|---:|\n| Viña Arana 75 cl | 21,77 € | 26,34 € | 24,64 € |");
    const sb = supabaseFalso();
    const historial = [...HILO, { role: "user" as const, content: PREGUNTA_2 },
      { role: "assistant" as const, content: "**Los cinco que más interesan**…", herramientas: [{ nombre: "comparar_presupuesto", argumentos: NINGUNO }] }];
    const r = await ejecutarConversacion({
      supabase: sb, claveOpenAI: "x", mensaje: PREGUNTA_3, historial, modelo: "gpt-x", uso: estado("gpt-x"),
      presupuesto: PRESUPUESTO, fetchImpl: ai.f, hoy: "2026-11-19",
    });
    expect(r.respuesta).not.toContain("### Interesa");
    expect(r.respuesta).not.toContain("Ahorro estimado al año");
    expect(r.respuesta).toContain("26,34 €");
    // El aviso le dice con qué descuento volver a mirar la tarifa y que conteste solo lo que pide.
    const avisos = ai.cuerpos[0].messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    expect(avisos).toMatch(/Ya se comparo con descuento ninguno/);
    expect(avisos).toMatch(/contesta SOLO lo que pregunta/);
    // Lo que ve el modelo tras la herramienta: precios por botella con y sin IVA y lo que pagó.
    // El último resultado de herramienta (los turnos anteriores también se reconstruyen como tool).
    const tool = ai.cuerpos[1].messages.filter((m) => m.role === "tool").pop()!;
    const visto = JSON.parse(String(tool.content));
    expect(visto.interesa[0]).toMatchObject({ sin_iva: 21.77, con_iva: 26.34, tu_precio_sin_iva: 24.64, tu_precio_con_iva: 29.81 });
    expect(visto.como_responder).toMatch(/SOLO lo que pregunta/);
    expect(sb.rpcs.find((x) => x.fn === "comparar_presupuesto_agente")?.args).toMatchObject({ p_presupuesto_id: ID, p_descuento_pct: null, p_descuento_importe: null });
  });

  it("pregunta 1 (primera comparación tras adjuntar): resumen corto y la tabla debajo, como hasta ahora", async () => {
    const ai = openaiFalso("**Sí: 36 productos te interesan**, con un ahorro estimado de 1.561,10 € al año.");
    const r = await ejecutarConversacion({
      supabase: supabaseFalso(), claveOpenAI: "x", mensaje: PREGUNTA_1, historial: HILO.slice(0, 2), modelo: "gpt-x", uso: estado("gpt-x"),
      presupuesto: PRESUPUESTO, fetchImpl: ai.f, hoy: "2026-11-19",
    });
    expect(r.respuesta).toContain("**Sí: 36 productos te interesan**");
    expect(r.respuesta).toContain("### Interesa: los 6 que más ahorran (de 6)");
    expect(r.respuesta).toContain("21,77 € · 75 cl");
    const avisos = ai.cuerpos[0].messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    expect(avisos).toMatch(/ya se pregunto por el proveedor y el descuento/);
  });
});

// ─── La comparación se guarda para los seguimientos (19/11/2026) ────────────
//  08:22 en la demo: «dime los cinco mejores…» → «No puedo consultar ahora…». La comparación se repetía en cada
//  pregunta y se cortó dos veces por el «statement timeout» de 8 s. Ahora se reutiliza la ya hecha.

/** Supabase con la tabla chat_presupuestos_comparaciones (lectura por clave y upsert). */
function supabaseConGuardadas(guardada: { datos: unknown; creado_en: string } | null) {
  const rpcs: string[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  const filtros: Array<[string, unknown]> = [];
  const consulta = {
    select() { return consulta; },
    eq(c: string, v: unknown) { filtros.push([c, v]); return consulta; },
    maybeSingle: async () => ({ data: guardada, error: null }),
  };
  return {
    rpcs, upserts, filtros,
    rpc(fn: string) {
      rpcs.push(fn);
      if (fn === "comparar_presupuesto_agente") return Promise.resolve({ data: { ...RESULTADO, hoy: "2026-11-19" }, error: null });
      return Promise.resolve({ data: [], error: null });
    },
    from(tabla: string) {
      if (tabla !== "chat_presupuestos_comparaciones") throw new Error(`tabla inesperada ${tabla}`);
      return { ...consulta, upsert: async (fila: Record<string, unknown>) => { upserts.push(fila); return { error: null }; } };
    },
  };
}

describe("la comparación ya hecha se reutiliza", () => {
  const ahora = new Date().toISOString();
  const preguntar = (sb: ReturnType<typeof supabaseConGuardadas>) => ejecutarConversacion({
    supabase: sb, claveOpenAI: "x", mensaje: "Dime los cinco mejores artículos para comprarle a este nuevo proveedor.",
    historial: HILO, modelo: "gpt-x", uso: estado("gpt-x"), presupuesto: PRESUPUESTO, fetchImpl: openaiFalso("1. Viña Arana…").f,
  });

  it("la clave cambia con el descuento y el proveedor, no con cómo se escribe", () => {
    const base = { p_presupuesto_id: ID, p_descuento_pct: null, p_descuento_importe: null, p_proveedor: null };
    expect(claveComparacion(base)).toBe("pct:|imp:|prov:");
    expect(claveComparacion({ ...base, p_descuento_pct: 5 })).not.toBe(claveComparacion(base));
    expect(claveComparacion({ ...base, p_proveedor: " Bodegas  Nuevas " })).toBe(claveComparacion({ ...base, p_proveedor: "bodegas nuevas" }));
  });

  it("guardada y vigente: no se vuelve a calcular", async () => {
    const sb = supabaseConGuardadas({ datos: { ...RESULTADO, hoy: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date()) }, creado_en: ahora });
    const r = await preguntar(sb);
    expect(sb.rpcs).not.toContain("comparar_presupuesto_agente");
    expect(sb.upserts).toHaveLength(0);
    expect(sb.filtros).toEqual([["presupuesto_id", ID], ["clave", "pct:|imp:|prov:"]]);
    expect(r.huboFalloDeHerramienta).toBe(false);
    expect(r.respuesta).not.toContain("### Interesa");
  });

  it("sin guardar o caducada: se calcula y se guarda para la siguiente", async () => {
    const sb = supabaseConGuardadas(null);
    await preguntar(sb);
    expect(sb.rpcs).toContain("comparar_presupuesto_agente");
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0]).toMatchObject({ presupuesto_id: ID, clave: "pct:|imp:|prov:" });
    expect((sb.upserts[0].datos as { lineas: unknown[] }).lineas).toHaveLength(RESULTADO.lineas.length);
    const vieja = new Date(Date.now() - VIGENCIA_COMPARACION_MS - 60_000).toISOString();
    const sb2 = supabaseConGuardadas({ datos: RESULTADO, creado_en: vieja });
    await preguntar(sb2);
    expect(sb2.rpcs).toContain("comparar_presupuesto_agente");
  });

  it("de otro día no vale aunque tenga menos de 6 horas (los precios de referencia pueden haber cambiado)", async () => {
    const sb = supabaseConGuardadas({ datos: { ...RESULTADO, hoy: "2026-11-18" }, creado_en: ahora });
    expect(await comparacionGuardada(sb, ID, "pct:|imp:|prov:", "2026-11-19")).toBeNull();
    expect(await comparacionGuardada(sb, ID, "pct:|imp:|prov:", "2026-11-18")).not.toBeNull();
  });

  it("si la tabla no está (BD sin migrar), se calcula como antes", async () => {
    const sb = supabaseFalso(); // su from() lanza
    const r = await ejecutarConversacion({
      supabase: sb, claveOpenAI: "x", mensaje: PREGUNTA_2, historial: HILO, modelo: "gpt-x", uso: estado("gpt-x"),
      presupuesto: PRESUPUESTO, fetchImpl: openaiFalso("1. Viña Arana…").f,
    });
    expect(sb.rpcs.map((x) => x.fn)).toContain("comparar_presupuesto_agente");
    expect(r.huboFalloDeHerramienta).toBe(false);
  });
});

// ─── Los tres tipos de archivo llegan al mismo punto ───────────────────────

describe("Excel, PDF y foto: guardan las líneas y preguntan el descuento", () => {
  const base = { sessionId: "s1", usuarioId: "u1", clave: "k", modelo: "gpt-x", parametros: { max_tokens: 100 } };
  const LECTURA = {
    proveedor: "Bodegas Nuevas", fecha: "2026-11-18", precios_con_iva: false,
    lineas: [{ producto: "Viña Arana Gran Reserva 75 cl", formato: "75 cl", unidad: "botella", contenido_cantidad: 75, contenido_unidad: "cl", cantidad: null, precio: 21.77, iva_pct: null }],
  };
  function openai() {
    return vi.fn(async (url: string, init: RequestInit) => {
      const cuerpo = String(init?.body ?? "");
      if (String(url).endsWith("/embeddings")) return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1] }], usage: { prompt_tokens: 1 } }), { status: 200 });
      // Confirmación de parejas (hoja.ts) o lectura del documento (presupuesto.ts).
      const contenido = cuerpo.includes("parejas") ? { parejas: [{ id: 0, opcion: 1, decision: "mismo_formato", motivo: "" }] } : LECTURA;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(contenido) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
    }) as unknown as typeof fetch;
  }
  function supabase() {
    const insertado: Array<Record<string, unknown>> = [];
    const cliente = {
      rpc: vi.fn(async (n: string, p?: { p_lineas?: unknown[] }) => n === "nombres_compras_agente"
        ? { data: [{ n: "V.VIÑA ARANA GRAN RESERVA 75CL", p: 7, c: "Viña Arana Gran Reserva 75 cl" }], error: null }
        : { data: (p?.p_lineas ?? []).map((_, i) => ({ i: i + 1, producto_id: 7, producto_catalogo: "Viña Arana Gran Reserva 75 cl", metodo: "texto", confianza: "alta" })), error: null }),
      from: vi.fn(() => ({
        delete: () => ({ lt: async () => ({}) }),
        insert: (fila: Record<string, unknown>) => { insertado.push(fila); return { select: () => ({ single: async () => ({ data: { id: ID }, error: null }) }) }; },
      })),
    };
    return { cliente, insertado };
  }
  const filasDeExcel = () => [{ hoja: "Tarifa", filas: [["Artículo", "Precio"], ["V.VIÑA ARANA GRAN RESERVA 75CL 14,5º C6", 21.77]] }];

  it.each([
    ["Excel", { nombre: "tarifa.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: "UEsDBA==" }, /De qué proveedor es/],
    ["PDF", { nombre: "oferta.pdf", mime: "application/pdf", base64: "JVBERi0=" }, /te aplica algún descuento/],
    ["foto", { nombre: "oferta.jpg", mime: "image/jpeg", base64: "/9j/4AAQ" }, /te aplica algún descuento/],
  ])("%s", async (tipo, adjunto, pregunta) => {
    const f = openai();
    const sb = supabase();
    const r = await procesarPresupuesto({ ...base, supabase: sb.cliente, fetchImpl: f, filasDeExcel, adjunto });
    expect(r.success).toBe(true);
    expect(r.presupuesto_id).toBe(ID);
    expect(r.respuesta).toMatch(pregunta);
    expect(sb.insertado).toHaveLength(1);
    expect((sb.insertado[0].lineas as Array<{ producto_id?: number }>)[0].producto_id).toBe(7);
    // No compara todavía: la comparación llega con la respuesta del descuento.
    expect(sb.cliente.rpc.mock.calls.map((c) => c[0])).not.toContain("comparar_presupuesto_agente");
    const cuerpos = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String((c[1] as RequestInit)?.body ?? ""));
    if (tipo === "PDF") expect(cuerpos.some((c) => c.includes('"type":"file"'))).toBe(true);
    if (tipo === "foto") expect(cuerpos.some((c) => c.includes('"type":"image_url"'))).toBe(true);
    // El Excel se lee sin la IA de lectura: ningún documento viaja a OpenAI.
    if (tipo === "Excel") expect(cuerpos.some((c) => c.includes('"type":"file"') || c.includes('"type":"image_url"'))).toBe(false);
  });
});
