import { describe, expect, it } from "vitest";
import {
  type ServicioContratado,
  borradorDe,
  cambiosDeBorrador,
  combinarMetricas,
  enlaceSecretosSupabase,
  formatearCantidad,
  formatearPorcentaje,
  haceCuanto,
  leerNumero,
  peorSemaforo,
  semaforo,
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
};

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
