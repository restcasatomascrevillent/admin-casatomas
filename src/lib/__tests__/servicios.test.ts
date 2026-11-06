import { describe, expect, it } from "vitest";
import {
  type LecturaServicio,
  type ServicioContratado,
  aEur,
  avisosConsumo,
  borradorDe,
  cambiosDeBorrador,
  combinarMetricas,
  cuotaMensual,
  enlaceSecretosSupabase,
  formatearCantidad,
  formatearPorcentaje,
  haceCuanto,
  leerNumero,
  estadoInstalacion,
  sinAclaracion,
  titularEstado,
  ordenarServicios,
  pendientesServicios,
  peorSemaforo,
  proveedorDeNombre,
  proximasRenovaciones,
  resumirCostes,
  servicioNuevo,
  semaforo,
  textoDias,
  textoImporteConEur,
  textoPrecio,
} from "../servicios";

const SERVICIO: ServicioContratado = {
  proveedor: "supabase",
  nombre: "Supabase",
  plan: "Free",
  precio_mensual: 0,
  moneda: "USD",
  ciclo: "gratuito",
  renovacion: null,
  cuenta: "Organización «Casa Tomas»",
  panel_url: "https://supabase.com/dashboard/org/_/usage",
  limites: {
    bd_tamano: { orden: 1, etiqueta: "Tamaño de la base de datos", limite: 500, unidad: "MB", periodo: "ahora", fuente: "https://supabase.com/docs/x" },
    almacenamiento: { orden: 2, etiqueta: "Archivos", limite: 1, unidad: "GB" },
    egreso: { orden: 5, etiqueta: "Egress", limite: 5, unidad: "GB", nota: "Sin API en Free." },
    usuarios_activos_mes: { orden: 3, etiqueta: "Usuarios activos", limite: 50000, unidad: "usuarios" },
  },
  notas: null,
  actualizado_en: "2026-11-03T10:00:00Z",
  categoria: "base_datos",
  orden: 20,
  activo: true,
  por_confirmar: false,
  precio_anual: null,
  fuente_precio: "https://supabase.com/pricing",
};
const servicio = (p: Partial<ServicioContratado> & Pick<ServicioContratado, "proveedor" | "nombre">): ServicioContratado => ({
  ...SERVICIO, limites: {}, ...p,
});

describe("semáforo (verde < 70 %, ámbar 70–90 %, rojo > 90 %)", () => {
  it.each([[0, "verde"], [69.9, "verde"], [70, "ambar"], [85, "ambar"], [90, "ambar"], [90.1, "rojo"], [140, "rojo"]] as const)("%s %% → %s", (p, s) => {
    expect(semaforo(p)).toBe(s);
  });
});

describe("combinarMetricas", () => {
  it("compara bytes con el límite en MB/GB, ordena y marca lo que no tiene dato", () => {
    const filas = combinarMetricas(SERVICIO, {
      metricas: {
        bd_tamano: { valor: 450 * 1024 ** 2, unidad: "bytes", limite: 500, unidad_limite: "MB" },
        almacenamiento: { valor: 120_083_232, unidad: "bytes" },
        usuarios_activos_mes: { valor: 2, unidad: "usuarios" },
        invocaciones_funciones_24h: { etiqueta: "Ejecuciones de funciones", valor: 1959, unidad: "invocaciones", periodo: "últimas 24 h", orden: 6 },
      },
    });
    expect(filas.map((f) => f.clave)).toEqual(["bd_tamano", "almacenamiento", "usuarios_activos_mes", "egreso", "invocaciones_funciones_24h"]);
    const [bd, sto, mau, egreso, inv] = filas;
    expect(bd).toMatchObject({ porcentaje: 90, semaforo: "ambar", textoValor: "450 MB", textoLimite: "500 MB" });
    expect(sto.porcentaje).toBeCloseTo(11.18, 1);
    expect(sto).toMatchObject({ semaforo: "verde", textoValor: "0,11 GB", textoLimite: "1 GB" });
    expect(mau).toMatchObject({ semaforo: "verde", textoValor: "2", textoLimite: "50.000 usuarios" });
    expect(egreso).toMatchObject({ valor: null, textoValor: null, porcentaje: null, nota: "Sin API en Free." });
    expect(inv).toMatchObject({ limite: null, porcentaje: null, textoValor: "1959 invocaciones", periodo: "últimas 24 h" });
    expect(peorSemaforo(filas)).toBe("ambar");
  });

  it("manda el límite de la tabla: si el dueño lo borra, no hay barra aunque la lectura lo traiga", () => {
    const sinLimite = { ...SERVICIO, limites: { bd_tamano: { ...SERVICIO.limites.bd_tamano, limite: null } } };
    const [bd] = combinarMetricas(sinLimite, { metricas: { bd_tamano: { valor: 10, unidad: "bytes", limite: 500, unidad_limite: "MB" } } });
    expect(bd).toMatchObject({ limite: null, porcentaje: null });
  });

  it("sin la métrica en la tabla, usa el límite de la lectura; unidades distintas → sin %", () => {
    const filas = combinarMetricas({ limites: {} }, {
      metricas: {
        a: { etiqueta: "A", valor: 95, unidad: "correos", limite: 100 },
        b: { etiqueta: "B", valor: 1, unidad: "horas", limite: 4, unidad_limite: "minutos" },
      },
    });
    expect(filas[0]).toMatchObject({ porcentaje: 95, semaforo: "rojo" });
    expect(filas[1]).toMatchObject({ porcentaje: null, semaforo: null });
    expect(peorSemaforo([])).toBeNull();
  });
});

/** Intl separa cifra y moneda con espacio irrompible: se compara como espacio normal. */
const t = (s: string | null) => (s ?? "").replace(/\u00a0/g, " ");

describe("formatos", () => {
  it("cantidades, monedas y porcentajes en español", () => {
    expect(t(formatearCantidad(7, "USD"))).toBe("7,00 US$");
    expect(t(formatearCantidad(75, "EUR"))).toBe("75,00 €");
    expect(t(formatearCantidad(1_000_000, "peticiones"))).toBe("1.000.000 peticiones");
    expect(t(formatearCantidad(3 * 1024 ** 3, "bytes"))).toBe("3 GB");
    expect(t(formatearCantidad(500, "MB"))).toBe("500 MB");
    expect(t(formatearPorcentaje(0.3))).toBe("menos del 1 %");
    expect(t(formatearPorcentaje(4.25))).toBe("4,3 %");
    expect(t(formatearPorcentaje(48.6))).toBe("49 %");
  });
  it("precio y antigüedad de la lectura", () => {
    expect(textoPrecio(SERVICIO)).toBe("Gratis");
    expect(textoPrecio({ precio_mensual: null, moneda: "EUR", ciclo: "por_uso" })).toBe("Pago por uso");
    expect(t(textoPrecio({ precio_mensual: 20, moneda: "USD", ciclo: "mensual" }))).toBe("20,00 US$ al mes");
    const ahora = new Date("2026-11-03T12:00:00Z");
    expect(haceCuanto("2026-11-03T11:57:00Z", ahora)).toBe("hace 3 min");
    expect(haceCuanto("2026-11-03T09:00:00Z", ahora)).toBe("hace 3 h");
    expect(haceCuanto(null, ahora)).toBe("nunca");
  });
  it("enlace a los secretos del proyecto al que apunta el panel", () => {
    expect(enlaceSecretosSupabase("https://haqmmdfdzzatdnrrcgez.supabase.co")).toBe("https://supabase.com/dashboard/project/haqmmdfdzzatdnrrcgez/functions/secrets");
    expect(enlaceSecretosSupabase(undefined)).toBe("https://supabase.com/dashboard/projects");
  });
});

describe("edición", () => {
  it("leerNumero entiende el formato español", () => {
    expect(leerNumero("1.000.000")).toBe(1_000_000);
    expect(leerNumero("19,99")).toBe(19.99);
    expect(leerNumero("2.5")).toBe(2.5);
    expect(leerNumero("  ")).toBeNull();
    expect(leerNumero("-5")).toBeNaN();
    expect(leerNumero("mucho")).toBeNaN();
  });
  it("valida como la migración y conserva etiqueta, fuente y orden de los límites", () => {
    const b = borradorDe(SERVICIO);
    b.plan = " Pro ";
    b.precio = "25";
    b.limites.bd_tamano = { limite: "8.192", unidad: "MB" };
    b.limites.egreso = { limite: "", unidad: "GB" };
    const r = cambiosDeBorrador(b, SERVICIO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cambios).toMatchObject({ plan: "Pro", precio_mensual: 25, renovacion: null });
    expect(r.cambios.limites.bd_tamano).toEqual({ ...SERVICIO.limites.bd_tamano, limite: 8192, unidad: "MB" });
    expect(r.cambios.limites.egreso.limite).toBeNull();
    expect(r.cambios.limites.egreso.nota).toBe("Sin API en Free.");
  });
  it("rechaza enlaces sin https, importes y límites no válidos", () => {
    const b = { ...borradorDe(SERVICIO), panel_url: "javascript:alert(1)", precio: "gratis", nombre: " " };
    b.limites = { ...b.limites, almacenamiento: { limite: "-1", unidad: "GB" } };
    const r = cambiosDeBorrador(b, SERVICIO);
    expect(r.ok).toBe(false);
    if (!("errores" in r)) return;
    expect(Object.keys(r.errores).sort()).toEqual(["limite.almacenamiento", "nombre", "panel_url", "precio"]);
  });
});

describe("coste", () => {
  it("cuota al mes según el ciclo y paso a euros", () => {
    expect(cuotaMensual({ precio_mensual: 0, moneda: "USD", ciclo: "gratuito" })).toEqual({ importe: 0, moneda: "USD" });
    expect(cuotaMensual({ precio_mensual: 20, moneda: "USD", ciclo: "mensual" })).toEqual({ importe: 20, moneda: "USD" });
    expect(cuotaMensual({ precio_mensual: null, precio_anual: 120, moneda: "EUR", ciclo: "anual" })).toEqual({ importe: 10, moneda: "EUR" });
    expect(cuotaMensual({ precio_mensual: 3, precio_anual: null, moneda: "EUR", ciclo: "anual" })).toEqual({ importe: 3, moneda: "EUR" });
    expect(cuotaMensual({ precio_mensual: null, moneda: "USD", ciclo: "por_uso" })).toEqual({ importe: 0, moneda: "USD" });
    expect(cuotaMensual({ precio_mensual: null, moneda: "EUR", ciclo: "mensual" })).toBeNull();
    expect(aEur(20, "USD", 0.9)).toBe(18);
    expect(aEur(5, "eur", 0.9)).toBe(5);
    expect(aEur(5, "GBP", 0.9)).toBeNull();
    expect(t(textoImporteConEur({ importe: 20, moneda: "USD" }, 0.894))).toBe("20,00 US$ (≈ 17,88 €)");
    expect(t(textoImporteConEur({ importe: 12, moneda: "EUR" }, 0.894))).toBe("12,00 €");
  });

  it("precio al año", () => {
    expect(t(textoPrecio({ precio_mensual: null, precio_anual: 14.99, moneda: "EUR", ciclo: "anual" }))).toBe("14,99 € al año");
    expect(t(textoPrecio({ precio_mensual: 2, precio_anual: null, moneda: "EUR", ciclo: "anual" }))).toBe("2,00 € al mes (pago anual)");
  });

  it("resumirCostes: cuotas + uso del mes en euros, sin los que no se usan, y la previsión del año", () => {
    const servicios = [
      servicio({ proveedor: "vercel", nombre: "Vercel", precio_mensual: 0, ciclo: "gratuito" }),
      servicio({ proveedor: "hostinger", nombre: "Hostinger", precio_mensual: null, precio_anual: 120, moneda: "EUR", ciclo: "anual", por_confirmar: true }),
      servicio({ proveedor: "openai", nombre: "OpenAI", precio_mensual: null, moneda: "USD", ciclo: "por_uso" }),
      servicio({ proveedor: "pro", nombre: "Pro en dólares", precio_mensual: 20, moneda: "USD", ciclo: "mensual" }),
      servicio({ proveedor: "loading", nombre: "Loading", precio_mensual: null, moneda: "EUR", ciclo: "anual" }),
      servicio({ proveedor: "perplexity", nombre: "Perplexity", precio_mensual: 50, moneda: "USD", ciclo: "mensual", activo: false }),
    ];
    const lecturas = {
      openai: { coste_variable: { importe: 3, moneda: "USD", periodo: "mes en curso", origen: "estimado" } },
      vercel: { coste_variable: null },
      perplexity: { coste_variable: { importe: 999, moneda: "USD" } },
    };
    // 10 de noviembre: han pasado 10 de 30 días.
    const r = resumirCostes(servicios, lecturas, 0.9, new Date("2026-11-10T12:00:00Z"));
    expect(r.filas.map((f) => f.proveedor)).toEqual(["pro", "hostinger", "openai", "loading", "vercel"]);
    expect(r.filas[0]).toMatchObject({ fijoEur: 18, variableEur: 0, totalEur: 18, fijo: { importe: 20, moneda: "USD" } });
    expect(r.filas[2]).toMatchObject({ fijoEur: 0, variableEur: 2.7, totalEur: 2.7 });
    expect(r.filas[3]).toMatchObject({ fijoEur: null, totalEur: 0 });
    expect(r).toMatchObject({ fijoMesEur: 28, variableMesEur: 2.7, totalMesEur: 30.7, fijoAnioEur: 336, hayUsd: true });
    // A fin de mes: 28 + 2,7 × 30/10 = 36,1. Al año: 36,1 × 12 = 433,2
    expect(r.previsionMesEur).toBe(36.1);
    expect(r.previsionAnioEur).toBe(433.2);
    expect(r.sinPrecio).toEqual(["Loading"]);
    expect(r.porConfirmar).toEqual(["Hostinger"]);
  });
});

describe("avisos y renovaciones", () => {
  const supa = SERVICIO;
  const lecturas = new Map<string, LecturaServicio>([
    ["supabase", { proveedor: "supabase", tomado_en: "", error: null, detalles: {}, metricas: {
      bd_tamano: { valor: 420 * 1024 ** 2, unidad: "bytes" }, almacenamiento: { valor: 0.95 * 1024 ** 3, unidad: "bytes" }, usuarios_activos_mes: { valor: 10, unidad: "usuarios" },
    } }],
    ["hostinger", { proveedor: "hostinger", tomado_en: "", error: null, metricas: {}, detalles: {
      dominios: [{ dominio: "restaurantecasatomascrevillente.es", estado: "active", caduca: "2027-01-15T10:00:00Z" }, { dominio: "viejo.es", estado: "expired", caduca: "2025-01-01T00:00:00Z" }],
      suscripciones: [{ nombre: "Premium Web Hosting", estado: "active", caduca: "2026-11-20T10:00:00Z", proxima_factura: "2026-11-20T10:00:00Z" }, { nombre: "Email", estado: "cancelled", caduca: "2026-11-05T00:00:00Z" }],
    } }],
  ]);

  it("avisosConsumo: desde el 80 %, de mayor a menor, solo de lo que se usa", () => {
    const avisos = avisosConsumo([supa, { ...supa, proveedor: "otro", nombre: "Otro", activo: false }], new Map([...lecturas, ["otro", { ...lecturas.get("supabase")!, proveedor: "otro" }]]));
    expect(avisos.map((a) => [a.clave, Math.round(a.porcentaje), a.semaforo])).toEqual([["almacenamiento", 95, "rojo"], ["bd_tamano", 84, "ambar"]]);
    expect(avisos[0]).toMatchObject({ nombre: "Supabase", textoLimite: "1 GB" });
  });

  it("proximasRenovaciones: la fecha apuntada y lo que dice la API (dominios y suscripciones activas), en orden", () => {
    const hostinger = servicio({ proveedor: "hostinger", nombre: "Hostinger", categoria: "dominio" });
    const loading = servicio({ proveedor: "loading", nombre: "Loading", categoria: "dominio", renovacion: "2026-11-01" });
    const apagado = servicio({ proveedor: "x", nombre: "X", renovacion: "2026-11-04", activo: false });
    const r = proximasRenovaciones([hostinger, loading, apagado], lecturas, new Date("2026-11-03T12:00:00Z"));
    expect(r.map((x) => [x.nombre, x.concepto, x.fecha, x.dias, x.deLaApi])).toEqual([
      ["Loading", "Renovación (dominio o plan)", "2026-11-01", -2, false],
      ["Hostinger", "Suscripción Premium Web Hosting", "2026-11-20", 17, true],
      ["Hostinger", "Dominio restaurantecasatomascrevillente.es", "2027-01-15", 73, true],
    ]);
    expect([textoDias(0), textoDias(1), textoDias(17), textoDias(-2)]).toEqual(["hoy", "mañana", "en 17 días", "hace 2 días"]);
  });

  it("ordenarServicios por orden y nombre", () => {
    const lista = [servicio({ proveedor: "b", nombre: "B", orden: 50 }), servicio({ proveedor: "a", nombre: "A", orden: 50 }), servicio({ proveedor: "c", nombre: "C", orden: 10 })];
    expect(ordenarServicios(lista).map((x) => x.proveedor)).toEqual(["c", "a", "b"]);
  });
});

describe("edición de los campos nuevos", () => {
  it("anual: se edita el precio al año (y el al mes queda vacío); categoría, orden, en uso y fuente", () => {
    const original = servicio({ proveedor: "loading", nombre: "Loading", ciclo: "anual", precio_mensual: 1.25, precio_anual: null, moneda: "EUR", categoria: "dominio", orden: 96 });
    const b = borradorDe(original);
    expect(b).toMatchObject({ precio: "15", categoria: "dominio", orden: "96", activo: true, por_confirmar: false });
    b.precio = "14,99";
    b.activo = false;
    b.fuente_precio = "https://www.loading.es/dominios/";
    const r = cambiosDeBorrador(b, original);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cambios).toMatchObject({ precio_mensual: null, precio_anual: 14.99, activo: false, orden: 96, categoria: "dominio", fuente_precio: "https://www.loading.es/dominios/" });
  });

  it("el límite que pone la lectura (tope de IA) sigue sin «limite» si no se escribe uno", () => {
    const openai = servicio({ proveedor: "openai", nombre: "OpenAI", limites: { gasto_ia_mes: { orden: 1, unidad: "EUR", limite_desde: "Tope de Costes" } } });
    const r = cambiosDeBorrador(borradorDe(openai), openai);
    if (!r.ok) throw new Error("no válido");
    expect("limite" in r.cambios.limites.gasto_ia_mes).toBe(false);
    expect(r.cambios.limites.gasto_ia_mes.limite_desde).toBe("Tope de Costes");
    const b = borradorDe(openai);
    b.limites.gasto_ia_mes = { limite: "10", unidad: "EUR" };
    const r2 = cambiosDeBorrador(b, openai);
    if (!r2.ok) throw new Error("no válido");
    expect(r2.cambios.limites.gasto_ia_mes.limite).toBe(10);
  });

  it("rechaza categoría, orden y fuente no válidos", () => {
    const b = { ...borradorDe(SERVICIO), categoria: "cosas", orden: "1,5", fuente_precio: "http://x.test" };
    const r = cambiosDeBorrador(b, SERVICIO);
    if (!("errores" in r)) throw new Error("debería fallar");
    expect(Object.keys(r.errores).sort()).toEqual(["categoria", "fuente_precio", "orden"]);
  });
});

describe("Estado de la instalación y lo que requiere atención", () => {
  const HOY = new Date("2026-11-03T12:00:00Z");
  const supa = SERVICIO;
  const resend = servicio({ proveedor: "resend", nombre: "Resend", limites: { correos_mes: { etiqueta: "Correos este mes", limite: 3000, unidad: "correos" } } });
  const vercel = servicio({ proveedor: "vercel", nombre: "Vercel" });
  const github = servicio({ proveedor: "github", nombre: "GitHub" });
  const vapi = servicio({ proveedor: "vapi", nombre: "Vapi" });
  const loading = servicio({ proveedor: "loading", nombre: "Loading", categoria: "dominio", renovacion: "2026-11-01" });
  const apagado = servicio({ proveedor: "perplexity", nombre: "Perplexity", activo: false, renovacion: "2026-11-04" });
  const lectura = (proveedor: string, p: Partial<LecturaServicio>): LecturaServicio => ({ proveedor, tomado_en: "", error: null, detalles: {}, metricas: {}, ...p });
  const lecturas = new Map<string, LecturaServicio>([
    ["supabase", lectura("supabase", { metricas: { bd_tamano: { valor: 300 * 1024 ** 2, unidad: "bytes" }, usuarios_activos_mes: { valor: 10, unidad: "usuarios" } } })],
    ["resend", lectura("resend", { metricas: { correos_mes: { valor: 2950, unidad: "correos" } } })],
    ["vercel", lectura("vercel", { error: "falta_secreto", secreto: "SERVICIOS_VERCEL_TOKEN" })],
    ["github", lectura("github", { error: "falta_secreto" })],
    ["vapi", lectura("vapi", { error: "error_api" })],
    ["perplexity", lectura("perplexity", { error: "credencial_rechazada" })],
  ]);
  const todos = [supa, resend, vercel, github, vapi, loading, apagado];

  it("estadoInstalacion: una ficha por servicio en uso, lo urgente primero, con dos o tres palabras", () => {
    const e = estadoInstalacion({ servicios: todos, lecturas, renovaciones: proximasRenovaciones(todos, lecturas, HOY) });
    const sinNbsp = (t: string) => t.replace(/\u00a0/g, " ");
    expect(e.fichas.map((f) => [f.proveedor, f.estado, sinNbsp(f.motivo)])).toEqual([
      ["resend", "rojo", "Al 98 %"],
      ["loading", "rojo", "Renovación pasada"],
      ["vercel", "ambar", "Falta la clave"],
      ["github", "ambar", "Falta la clave"],
      ["vapi", "ambar", "No se pudo leer"],
      ["supabase", "verde", "Bien"],
    ]);
    // El anillo: la métrica más cerca de su límite (Supabase: la base de datos al 60 %).
    expect(Math.round(e.fichas.at(-1)!.principal!.porcentaje)).toBe(60);
    expect(e.fichas.find((f) => f.proveedor === "resend")!.principal).toMatchObject({ etiqueta: "Correos este mes" });
    expect(e.cuenta).toEqual({ rojo: 2, ambar: 3, verde: 1, gris: 0 });
    expect(e.general).toBe("rojo");
    expect(titularEstado(e)).toBe("2 servicios necesitan atención");
    // Lo que no se usa (Perplexity, con la clave rechazada) no tiene ficha.
    expect(e.fichas.some((f) => f.proveedor === "perplexity")).toBe(false);
  });

  it("estadoInstalacion: clave rechazada en rojo, renovación cercana en ámbar y sin datos en gris (no empeora el total)", () => {
    const rechazada = servicio({ proveedor: "stripe", nombre: "Stripe" });
    const dominio = servicio({ proveedor: "hostinger", nombre: "Hostinger", renovacion: "2026-11-23" });
    const manual = servicio({ proveedor: "google", nombre: "Google Maps Platform (reseñas)" });
    const nuevo = servicio({ proveedor: "nuevo", nombre: "Nuevo" });
    const lect = new Map<string, LecturaServicio>([
      ["stripe", lectura("stripe", { error: "credencial_rechazada" })],
      ["hostinger", lectura("hostinger", {})],
    ]);
    const servs = [rechazada, dominio, manual, nuevo];
    const e = estadoInstalacion({ servicios: servs, lecturas: lect, renovaciones: proximasRenovaciones(servs, lect, HOY), sinLector: new Set(["google"]) });
    expect(e.fichas.map((f) => [f.nombre, f.estado, f.motivo])).toEqual([
      ["Stripe", "rojo", "Clave rechazada"],
      ["Hostinger", "ambar", "Renueva en 20 días"],
      ["Google Maps Platform", "gris", "Se mira en su panel"],
      ["Nuevo", "gris", "Sin datos aún"],
    ]);
    expect(e.fichas[2].nombreCompleto).toBe("Google Maps Platform (reseñas)");

    const soloAvisos = estadoInstalacion({ servicios: [dominio, manual], lecturas: lect, renovaciones: proximasRenovaciones([dominio], lect, HOY), sinLector: new Set(["google"]) });
    expect([soloAvisos.general, titularEstado(soloAvisos)]).toEqual(["ambar", "Todo funciona · 1 aviso"]);
    const bien = estadoInstalacion({ servicios: [dominio, manual], lecturas: lect, renovaciones: [], sinLector: new Set(["google"]) });
    expect([bien.general, titularEstado(bien)]).toEqual(["verde", "Todo en orden"]);
    const vacio = estadoInstalacion({ servicios: [manual], lecturas: new Map(), renovaciones: [], sinLector: new Set(["google"]) });
    expect([vacio.general, titularEstado(vacio)]).toEqual(["gris", "Todavía sin datos"]);
  });

  it("sinAclaracion quita solo el paréntesis final", () => {
    expect(sinAclaracion("Vapi (asistente telefónico)")).toBe("Vapi");
    expect(sinAclaracion("Visitas a las webs (peticiones al CDN)")).toBe("Visitas a las webs");
    expect(sinAclaracion("Gasto de IA")).toBe("Gasto de IA");
  });

  it("pendientesServicios: rojo primero; las claves que faltan juntas; renovaciones; IA; por confirmar", () => {
    const renovaciones = proximasRenovaciones(todos, lecturas, HOY);
    const r = pendientesServicios({
      servicios: todos,
      lecturas,
      renovaciones,
      resumen: { sinPrecio: ["Loading"], porConfirmar: ["Resend", "Loading"] },
      ia: { sinRegistro: 2, modelosSinTarifa: 1 },
    });
    expect(r.map((p) => [p.clave, p.gravedad, p.destino])).toEqual([
      ["consumo:resend:correos_mes", "rojo", { pestana: "servicios", proveedor: "resend" }],
      ["renovacion:loading:Renovación (dominio o plan):2026-11-01", "rojo", { pestana: "servicios", proveedor: "loading" }],
      ["error:falta_secreto", "ambar", { pestana: "servicios", proveedor: undefined }],
      ["error:lectura", "ambar", { pestana: "servicios", proveedor: "vapi" }],
      ["ia:sin-registro", "ambar", { pestana: "costes" }],
      ["ia:sin-tarifa", "ambar", { pestana: "costes" }],
      ["configurar:por-confirmar", "info", { pestana: "configurar" }],
    ]);
    const [consumo, renov, claves, lecturaFallida, ia] = r;
    expect(consumo.titulo).toBe("Resend · Correos este mes");
    expect(consumo.detalle?.replace(/\u00a0/g, " ")).toBe("98 % del límite (2950 de 3000 correos)");
    expect(renov.detalle).toBe("Pasó hace 2 días (01/11/2026): apunta la nueva fecha");
    expect(claves.titulo).toBe("Vercel, GitHub: falta configurar la clave");
    expect(lecturaFallida.titulo).toBe("Vapi: no se pudieron leer los datos");
    expect(ia.titulo).toBe("2 funciones de IA no registran su gasto");
    expect(r.at(-1)).toMatchObject({ titulo: "2 servicios con el plan o el precio por confirmar", accion: "Revisar" });
    // Lo que no se usa (Perplexity) no pide nada: ni su clave rechazada ni su renovación.
    expect(r.some((p) => p.titulo.includes("Perplexity"))).toBe(false);
  });

  it("renovación en 30 días o menos: ámbar; a más de 30, nada; sin lectura automática no se pide clave", () => {
    const pronto = servicio({ proveedor: "dominio", nombre: "Dominio", renovacion: "2026-11-23" });
    const lejos = servicio({ proveedor: "lejos", nombre: "Lejos", renovacion: "2026-12-31" });
    const sinApi = servicio({ proveedor: "sinapi", nombre: "Sin API" });
    const lect = new Map<string, LecturaServicio>([["sinapi", lectura("sinapi", { error: "falta_secreto" })]]);
    const r = pendientesServicios({
      servicios: [pronto, lejos, sinApi],
      lecturas: lect,
      renovaciones: proximasRenovaciones([pronto, lejos], lect, HOY),
      resumen: { sinPrecio: [], porConfirmar: [] },
      sinLector: new Set(["sinapi"]),
    });
    expect(r.map((p) => [p.titulo, p.gravedad, p.detalle])).toEqual([["Dominio · Renovación del plan", "ambar", "Se renueva en 20 días (23/11/2026)"]]);
    expect(pendientesServicios({ servicios: [], lecturas: new Map(), renovaciones: [], resumen: { sinPrecio: [], porConfirmar: [] } })).toEqual([]);
  });
});

describe("alta de servicios", () => {
  it("proveedorDeNombre: minúsculas sin tildes ni símbolos, válida para la tabla y sin chocar", () => {
    expect(proveedorDeNombre("Google Analytics", [])).toBe("google_analytics");
    expect(proveedorDeNombre("  Cámara & Señal (TPV) ", [])).toBe("camara_senal_tpv");
    expect(proveedorDeNombre("Vercel", ["vercel", "vercel_2"])).toBe("vercel_3");
    expect(proveedorDeNombre("X", [])).toBe("servicio_x");
    expect(proveedorDeNombre("¡¡!!", [])).toBe("servicio");
    const larga = proveedorDeNombre("Un nombre de servicio larguísimo que no cabe en cuarenta letras", []);
    expect(larga.length).toBeLessThanOrEqual(40);
    for (const clave of [larga, proveedorDeNombre("Vercel", ["vercel"]), proveedorDeNombre("X", [])]) expect(clave).toMatch(/^[a-z0-9_-]{2,40}$/);
  });

  it("servicioNuevo: ficha vacía en uso, mensual en euros y que valida solo con el nombre", () => {
    const nuevo = servicioNuevo(106);
    expect(nuevo).toMatchObject({ nombre: "", ciclo: "mensual", moneda: "EUR", categoria: "otros", orden: 106, activo: true, limites: {} });
    expect(servicioNuevo(20000).orden).toBe(10000);
    const b = borradorDe(nuevo);
    const vacio = cambiosDeBorrador(b, nuevo);
    if (!("errores" in vacio)) throw new Error("debería fallar sin nombre");
    expect(Object.keys(vacio.errores)).toEqual(["nombre"]);
    const r = cambiosDeBorrador({ ...b, nombre: "n8n" }, nuevo);
    if (!r.ok) throw new Error("no válido");
    expect(r.cambios).toMatchObject({ nombre: "n8n", plan: null, precio_mensual: null, precio_anual: null, activo: true, limites: {} });
  });
});
