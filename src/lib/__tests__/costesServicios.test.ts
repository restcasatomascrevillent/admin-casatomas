import { describe, expect, it } from "vitest";
import {
  avisosPlan,
  borradorPrecioDe,
  cambiosConfirmarPrecio,
  compararConMesAnterior,
  costesPorAccion,
  diasDeCrecimiento,
  type FilaCostePorUso,
  inventarioServicios,
  normalizarCostePorUso,
  pendientesDePlan,
  plural,
  textoCosteUso,
  textoSiguientePlan,
  totalesIa,
  ventanaMes,
  ventanasIa,
} from "../costesServicios";
import { type LecturaServicio, type ServicioContratado, pendientesServicios } from "../servicios";

/** Intl separa cifra y moneda (y el «%») con espacio irrompible. */
const t = (s: string | null | undefined) => (s ?? "").replace(/\u00a0/g, " ");

const servicio = (p: Partial<ServicioContratado> & Pick<ServicioContratado, "proveedor" | "nombre">): ServicioContratado => ({
  plan: "Free", precio_mensual: 0, moneda: "USD", ciclo: "gratuito", renovacion: null, cuenta: null, panel_url: `https://${p.proveedor}.example/panel`,
  limites: {}, notas: null, actualizado_en: "2026-11-03T10:00:00Z", categoria: "otros", orden: 100, activo: true, por_confirmar: false,
  precio_anual: null, fuente_precio: null, ...p,
});

describe("Inventario de servicios (paso 1)", () => {
  it("para qué, plan, precio al mes y al año en euros (con el original en dólares) y el estado del precio", () => {
    const inv = inventarioServicios([
      servicio({ proveedor: "vercel", nombre: "Vercel", plan: "Hobby", para_que: "Publica las webs", fuente_precio: "https://vercel.com/pricing" }),
      servicio({ proveedor: "pro", nombre: "Pro", plan: "Pro", ciclo: "mensual", precio_mensual: 20, por_confirmar: false, precio_confirmado_en: "2026-11-13" }),
      servicio({ proveedor: "dominio", nombre: "Dominio", plan: "Anual", ciclo: "anual", precio_anual: 120, moneda: "EUR", por_confirmar: true }),
      servicio({ proveedor: "loading", nombre: "Loading", plan: "Por confirmar", ciclo: "anual", precio_mensual: null, moneda: "EUR", por_confirmar: true }),
      servicio({ proveedor: "stripe", nombre: "Stripe", ciclo: "por_uso", precio_mensual: null, moneda: "EUR" }),
      servicio({ proveedor: "viejo", nombre: "Viejo", activo: false }),
    ], 0.9);
    expect(inv.filas.map((f) => [f.proveedor, f.estado])).toEqual([
      ["vercel", "confirmado"], ["pro", "confirmado"], ["dominio", "por_confirmar"], ["loading", "sin_precio"], ["stripe", "confirmado"],
    ]);
    const [vercel, pro, dominio, loading, stripe] = inv.filas;
    expect([vercel.textoMes, vercel.textoAnio, vercel.paraQue, vercel.fuentePrecio]).toEqual(["Gratis", null, "Publica las webs", "https://vercel.com/pricing"]);
    expect(t(pro.textoMes)).toBe("20,00 US$ (≈ 18,00 €)");
    expect(t(pro.textoAnio)).toBe("240,00 US$ (≈ 216,00 €)");
    expect(pro.confirmadoEn).toBe("13/11/2026");
    expect([t(dominio.textoMes), t(dominio.textoAnio), dominio.mesEur, dominio.anioEur, dominio.confirmadoEn]).toEqual(["10,00 €", "120,00 €", 10, 120, null]);
    expect([loading.textoMes, loading.mesEur]).toEqual(["Sin precio", null]);
    expect(stripe.textoMes).toBe("Sin cuota (pago por uso)");
    expect(inv.porConfirmar).toBe(2);
    expect([inv.cuotasMesEur, inv.cuotasAnioEur]).toEqual([28, 336]);
  });
});

describe("«Confirmar precio»", () => {
  const hoy = "2026-11-13";
  it("parte de lo apuntado (sin el «por confirmar» del plan) y lo confirma con la fecha de hoy", () => {
    const b = borradorPrecioDe(servicio({ proveedor: "resend", nombre: "Resend", plan: "Free (por confirmar)", fuente_precio: "https://resend.com/pricing" }));
    expect(b).toEqual({ plan: "Free", ciclo: "gratuito", precio: "0", moneda: "USD", fuente_precio: "https://resend.com/pricing" });
    expect(borradorPrecioDe(servicio({ proveedor: "l", nombre: "L", plan: "Por confirmar", ciclo: "anual", precio_mensual: 2 })).precio).toBe("24");
    expect(cambiosConfirmarPrecio(b, hoy)).toEqual({
      ok: true,
      cambios: { plan: "Free", ciclo: "gratuito", precio_mensual: 0, precio_anual: null, moneda: "USD", fuente_precio: "https://resend.com/pricing", por_confirmar: false, precio_confirmado_en: hoy },
    });
  });

  it("al año guarda el precio anual; cada mes o cada año exige precio; valida plan, importe y enlace", () => {
    const r = cambiosConfirmarPrecio({ plan: "Dominio .es", ciclo: "anual", precio: "14,99", moneda: "EUR", fuente_precio: "" }, hoy);
    expect(r).toMatchObject({ ok: true, cambios: { precio_anual: 14.99, precio_mensual: null, fuente_precio: null } });
    const sinPrecio = cambiosConfirmarPrecio({ plan: "Pro", ciclo: "mensual", precio: "", moneda: "USD", fuente_precio: "" }, hoy);
    expect(sinPrecio).toEqual({ ok: false, errores: { precio: "Escribe lo que se paga al mes." } });
    const mal = cambiosConfirmarPrecio({ plan: " ", ciclo: "mensual", precio: "veinte", moneda: "USD", fuente_precio: "http://x" }, hoy);
    expect(Object.keys((mal as { errores: Record<string, string> }).errores).sort()).toEqual(["fuente_precio", "plan", "precio"]);
    // Según uso: la cuota es opcional.
    expect(cambiosConfirmarPrecio({ plan: "Pago por uso", ciclo: "por_uso", precio: "", moneda: "USD", fuente_precio: "" }, hoy)).toMatchObject({ ok: true, cambios: { precio_mensual: null } });
  });
});

describe("El mes frente al anterior (paso 5)", () => {
  it("diferencia de la previsión con el mes anterior, en euros y en %", () => {
    expect(compararConMesAnterior({ totalMesEur: 5, previsionMesEur: 12 }, 10)).toEqual({ llevamosEur: 5, previsionEur: 12, anteriorEur: 10, diferenciaEur: 2, diferenciaPct: 20 });
    expect(compararConMesAnterior({ totalMesEur: 5, previsionMesEur: 12 }, null)).toMatchObject({ anteriorEur: null, diferenciaEur: null, diferenciaPct: null });
    expect(compararConMesAnterior({ totalMesEur: 0, previsionMesEur: 3 }, 0)).toMatchObject({ diferenciaEur: 3, diferenciaPct: null });
  });
});

describe("Antes de pasar del plan gratis (paso 6)", () => {
  const MB = 1024 ** 2;
  const supabase = servicio({
    proveedor: "supabase", nombre: "Supabase", plan_siguiente: "Pro", precio_siguiente: 25, si_se_pasa: "Supabase puede limitar el proyecto.",
    limites: {
      bd_tamano: { etiqueta: "Tamaño de la base de datos", limite: 500, unidad: "MB", periodo: "ahora", fuente: "https://supabase.com/docs", si_se_pasa: "Pasa a solo lectura." },
      almacenamiento: { etiqueta: "Fotos y archivos guardados (Storage)", limite: 1, unidad: "GB", periodo: "ahora", fuente: "https://supabase.com/docs" },
      egreso: { etiqueta: "Datos servidos (egress)", limite: 5, unidad: "GB", periodo: "mes en curso", fuente: "https://supabase.com/docs", nota: "Supabase no da este dato por API en el plan Free: míralo en su panel (Usage)." },
      conexiones: { etiqueta: "Conexiones", limite: 60, unidad: "conexiones" },
    },
  });
  const resend = servicio({
    proveedor: "resend", nombre: "Resend", plan_siguiente: "Pro", precio_siguiente: 20,
    limites: {
      correos_mes: { etiqueta: "Correos enviados este mes", limite: 3000, unidad: "correos", periodo: "mes en curso", fuente: "https://resend.com/docs" },
      correos_hoy: { etiqueta: "Correos enviados hoy", limite: 100, unidad: "correos", periodo: "hoy (UTC)", fuente: "https://resend.com/docs" },
    },
  });
  const vercel = servicio({
    proveedor: "vercel", nombre: "Vercel", plan_siguiente: "Pro", precio_siguiente: 20,
    limites: {
      cpu_activa: { etiqueta: "Tiempo de CPU de las funciones", limite: 4, unidad: "horas", periodo: "últimos 30 días", fuente: "https://vercel.com/docs/plans/hobby" },
      peticiones_cdn: { etiqueta: "Visitas a las webs (peticiones al CDN)", limite: 1000000, unidad: "peticiones", periodo: "últimos 30 días", fuente: "https://vercel.com/docs/plans/hobby" },
      recortes_servidor_mes: { etiqueta: "Recortes (tope del panel)", limite: 600, unidad: "fotos", periodo: "mes en curso" },
    },
  });
  const pago = servicio({ proveedor: "openai", nombre: "OpenAI", ciclo: "por_uso", precio_mensual: null, limites: { x: { limite: 1, unidad: "u", fuente: "https://o" } } });
  const lecturas = new Map<string, LecturaServicio>([
    ["supabase", {
      proveedor: "supabase", tomado_en: "", error: null, detalles: {},
      metricas: {
        bd_tamano: { valor: 357 * MB, unidad: "bytes", periodo: "ahora" },
        bd_crecimiento: { valor: 273 * MB, unidad: "bytes", periodo: "últimos 7 días", nota: "+273 MB en 7 días." },
        almacenamiento: { valor: 130 * MB, unidad: "bytes", periodo: "ahora" },
        conexiones: { valor: 59, unidad: "conexiones" },
      },
    }],
    ["resend", {
      proveedor: "resend", tomado_en: "", error: null, detalles: {},
      metricas: { correos_mes: { valor: 1100, unidad: "correos", periodo: "mes en curso" }, correos_hoy: { valor: 30, unidad: "correos", periodo: "hoy (UTC)" } },
    }],
    ["vercel", { proveedor: "vercel", tomado_en: "", error: "falta_secreto", detalles: {}, metricas: { recortes_servidor_mes: { valor: 590, unidad: "fotos" } } }],
  ]);
  const hoy = new Date("2026-11-10T12:00:00Z");

  it("solo los límites del plan (con página oficial) de los planes gratis o con plan siguiente, lo urgente primero", () => {
    const a = avisosPlan({ servicios: [vercel, resend, supabase, pago], lecturas, eurPorUsd: 0.9, hoy });
    expect(a.map((x) => [x.clave, x.nivel])).toEqual([
      ["supabase:bd_tamano", "rojo"],
      ["resend:correos_mes", "rojo"],
      ["resend:correos_hoy", "verde"],
      ["supabase:almacenamiento", "verde"],
      ["supabase:egreso", "sin_dato"],
      ["vercel:cpu_activa", "sin_dato"],
      ["vercel:peticiones_cdn", "sin_dato"],
    ]);
  });

  it("la base de datos: cuándo llegaría al límite al ritmo de la última semana, qué pasaría y el plan siguiente", () => {
    const [bd] = avisosPlan({ servicios: [supabase], lecturas, eurPorUsd: 0.9, hoy });
    expect(Math.round(bd.porcentaje!)).toBe(71);
    // (500 − 357) / (273 / 7) = 3,67 → 3 días.
    expect(bd.diasHastaLimite).toBe(3);
    expect(t(bd.prevision)).toBe("Al ritmo de los últimos 7 días (+273 MB), llegaría al límite en unos 3 días.");
    expect(bd.quePasaria).toBe("Pasa a solo lectura.");
    expect(t(bd.siguientePlan)).toBe("Pro: 25,00 US$ al mes (≈ 22,50 €)");
    expect(bd.servicio).toBe("Supabase");
  });

  it("los del mes en curso se proyectan a fin de mes; los diarios y de 30 días, no; lo que no se lee dice por qué", () => {
    const a = avisosPlan({ servicios: [resend, supabase, vercel], lecturas, eurPorUsd: 0.9, hoy });
    const mes = a.find((x) => x.clave === "resend:correos_mes")!;
    // 1.100 el día 10 de 30 → 3.300 a fin de mes: 110 % → rojo.
    expect(Math.round(mes.porcentajePrevisto!)).toBe(110);
    expect(t(mes.prevision)).toBe("A este ritmo, a fin de mes: 110 % (3300 de 3000 correos)");
    expect(mes.quePasaria).toBeNull();
    expect(a.find((x) => x.clave === "resend:correos_hoy")!.prevision).toBeNull();
    const egreso = a.find((x) => x.clave === "supabase:egreso")!;
    expect(egreso.motivoSinDato).toMatch(/míralo en su panel/);
    expect(egreso.quePasaria).toBe("Supabase puede limitar el proyecto.");
    expect(a.find((x) => x.clave === "vercel:cpu_activa")!.motivoSinDato).toBe("Falta la clave para leerlo (en su tarjeta está cómo crearla).");
    const demo = avisosPlan({ servicios: [vercel], lecturas, eurPorUsd: 0.9, hoy, clavesSoloEnProduccion: true });
    expect(demo[0].motivoSinDato).toBe("En la demo no se lee: la clave solo está en producción.");
  });

  it("Estado › «Qué mirar»: lo que se pasaría pronto aunque hoy esté por debajo del 80 %", () => {
    const a = avisosPlan({ servicios: [resend, supabase], lecturas, eurPorUsd: 0.9, hoy });
    const p = pendientesDePlan(a);
    expect(p.map((x) => [x.clave, x.gravedad, t(x.titulo)])).toEqual([
      ["plan:supabase:bd_tamano", "rojo", "Supabase · Tamaño de la base de datos: llegaría al límite del plan en unos 3 días"],
      ["plan:resend:correos_mes", "rojo", "Resend · Correos enviados este mes: a este ritmo, 110 % a fin de mes"],
    ]);
    const pend = pendientesServicios({ servicios: [], lecturas: new Map(), renovaciones: [], resumen: { sinPrecio: [], porConfirmar: [] }, planes: p });
    expect(pend[0]).toMatchObject({ clave: "plan:supabase:bd_tamano", destino: { pestana: "costes" }, accion: "Ver en Costes", detalle: "Pasa a solo lectura." });
  });

  it("los primeros días del mes no se proyecta (un día raro lo dispararía todo)", () => {
    const a = avisosPlan({ servicios: [resend], lecturas, eurPorUsd: 0.9, hoy: new Date("2026-11-02T12:00:00Z") });
    expect(a.find((x) => x.clave === "resend:correos_mes")!.prevision).toBeNull();
  });

  it("días de crecimiento: de la nota, del periodo o desde una fecha", () => {
    expect(diasDeCrecimiento({ nota: "+273 MB en 7 días.", periodo: "x" })).toBe(7);
    expect(diasDeCrecimiento({ nota: "+1 MB en 1 día.", periodo: null })).toBe(1);
    expect(diasDeCrecimiento({ periodo: "últimos 7 días" })).toBe(7);
    expect(diasDeCrecimiento({ periodo: "desde el 03/11/2026" }, new Date("2026-11-13T00:00:00Z"))).toBe(10);
    expect(diasDeCrecimiento({ periodo: "ahora" })).toBeNull();
  });

  it("el plan siguiente en palabras", () => {
    expect(t(textoSiguientePlan({ plan_siguiente: "Google One 100 GB", precio_siguiente: 1.99, moneda: "EUR" }, 0.9))).toBe("Google One 100 GB: 1,99 € al mes");
    expect(textoSiguientePlan({ plan_siguiente: "Pago por uso", precio_siguiente: null, moneda: "USD" }, 0.9)).toBe("Pago por uso");
    expect(textoSiguientePlan({ plan_siguiente: null, precio_siguiente: null, moneda: "USD" }, 0.9)).toBeNull();
  });
});

const fila = (p: Partial<FilaCostePorUso> & Pick<FilaCostePorUso, "funcion">): FilaCostePorUso => ({
  queHace: null, accion: null, unidad: "llamada", orden: 100, llamadas: 1, usos: 1, usosConCoste: 1, costeUsd: 0.01, filasSinTarifa: 0,
  modelosSinTarifa: [], medianaUsd: 0.01, mediaUsd: 0.01, servidorPropio: false, ...p,
});

describe("IA función por función y lo que cuesta cada cosa (pasos 3 y 4)", () => {
  it("normaliza la RPC (numeric como texto) sin convertir NULL en 0", () => {
    const [f] = normalizarCostePorUso([{
      funcion: "ocr-trabajo", que_hace: "Lee facturas", accion: "Leer una factura", unidad: "documento", orden: 25, llamadas: "586", usos: "316",
      usos_con_coste: 316, coste_usd: "1.436", filas_sin_tarifa: 0, modelos_sin_tarifa: [], mediana_usd: "0.0062", media_usd: null, servidor_propio: false,
    }, null, { sin: "funcion" }]);
    expect(f).toEqual({
      funcion: "ocr-trabajo", queHace: "Lee facturas", accion: "Leer una factura", unidad: "documento", orden: 25, llamadas: 586, usos: 316, usosConCoste: 316,
      costeUsd: 1.436, filasSinTarifa: 0, modelosSinTarifa: [], medianaUsd: 0.0062, mediaUsd: null, servidorPropio: false,
    });
    expect(normalizarCostePorUso("x")).toEqual([]);
  });

  it("el coste de una cosa en palabras: céntimos, euros, gratis (en nuestro servidor) o sin datos", () => {
    expect(textoCosteUso(0.0062, 0.9)).toBe("≈ 0,6 céntimos");
    expect(textoCosteUso(0.0007, 0.9)).toBe("≈ 0,06 céntimos");
    expect(textoCosteUso(0.0000001, 0.9)).toBe("menos de 0,01 céntimos");
    expect(textoCosteUso(0.0111, 0.9)).toBe("≈ 1,0 céntimo");
    expect(textoCosteUso(0.2, 0.9)).toBe("≈ 18 céntimos");
    expect(textoCosteUso(1.5, 0.9)).toBe("≈ 1,35 €");
    expect(textoCosteUso(0, 0.9, true)).toBe("gratis (en nuestro servidor)");
    expect(textoCosteUso(0, 0.9)).toBe("gratis");
    expect(textoCosteUso(null, 0.9)).toBe("sin datos");
  });

  it("plurales de las unidades", () => {
    expect([plural("documento", 2), plural("petición", 3), plural("resumen", 2), plural("foto", 1), plural("tanda", 4), plural("incidencia", 2)])
      .toEqual(["documentos", "peticiones", "resúmenes", "foto", "tandas", "incidencias"]);
  });

  it("las cuatro cosas pedidas siempre (con el mes anterior si este no se usó) y después las demás con acción", () => {
    const actual = [
      fila({ funcion: "ocr-trabajo", accion: "Leer una factura", unidad: "documento", usos: 316, usosConCoste: 316, medianaUsd: 0.0062 }),
      fila({ funcion: "recortar-foto", accion: "Recortar una foto", unidad: "foto", usos: 2, usosConCoste: 2, medianaUsd: 0, servidorPropio: true }),
      fila({ funcion: "chat-facturas", accion: "Contestar una pregunta en el chat de Facturas", unidad: "pregunta", orden: 30, usos: 3, usosConCoste: 1, medianaUsd: 0.002 }),
      fila({ funcion: "sin-accion", accion: null }),
      fila({ funcion: "clasificar-productos", accion: "Clasificar una tanda", unidad: "tanda", orden: 80, usosConCoste: 0, medianaUsd: null }),
    ];
    const anterior = [fila({ funcion: "extraer-vino-foto", accion: "Leer la etiqueta de un vino", unidad: "foto", usos: 7, usosConCoste: 7, medianaUsd: 0.03 })];
    const r = costesPorAccion({ actual, anterior, eurPorUsd: 0.9, textoMes: "noviembre de 2026", textoMesAnterior: "octubre de 2026" });
    expect(r.map((a) => [a.funcion, a.accion, a.texto, a.detalle, a.delMesAnterior])).toEqual([
      ["ocr-trabajo", "Leer una factura", "≈ 0,6 céntimos", "mediana de 316 documentos de noviembre de 2026", false],
      ["extraer-vino-foto", "Leer la etiqueta de un vino", "≈ 2,7 céntimos", "mediana de 7 fotos de octubre de 2026", true],
      ["traducir-contenido", "Traducir un plato", "sin usos todavía", null, false],
      ["recortar-foto", "Recortar una foto", "gratis (en nuestro servidor)", "mediana de 2 fotos de noviembre de 2026", false],
      ["chat-facturas", "Contestar una pregunta en el chat de Facturas", "≈ 0,2 céntimos", "1 pregunta de noviembre de 2026", false],
    ]);
  });

  it("totales: coste conocido, llamadas, usos y los modelos sin tarifa", () => {
    const tot = totalesIa([
      fila({ funcion: "a", costeUsd: 0.5, llamadas: 10, usos: 4 }),
      fila({ funcion: "b", costeUsd: null, llamadas: 3, usos: 2, filasSinTarifa: 2, modelosSinTarifa: ["gpt-6.1-terra"] }),
      fila({ funcion: "c", costeUsd: 0.25, llamadas: 1, usos: 1, filasSinTarifa: 1, modelosSinTarifa: ["gpt-6.1-terra", "otro"] }),
    ]);
    expect(tot).toEqual({ costeUsd: 0.75, llamadas: 14, usos: 7, filasSinTarifa: 3, modelosSinTarifa: ["gpt-6.1-terra", "otro"] });
  });

  it("ventanas: este mes del 1 a hoy y el anterior entero; un mes entero", () => {
    expect(ventanasIa(new Date(2026, 10, 13, 12))).toEqual({
      actual: { desde: "2026-11-01", hasta: "2026-11-13", mes: "2026-11-01" },
      anterior: { desde: "2026-10-01", hasta: "2026-10-31", mes: "2026-10-01" },
    });
    expect(ventanasIa(new Date(2026, 0, 5, 12)).anterior).toEqual({ desde: "2025-12-01", hasta: "2025-12-31", mes: "2025-12-01" });
    expect(ventanaMes("2026-02-01")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
  });
});
