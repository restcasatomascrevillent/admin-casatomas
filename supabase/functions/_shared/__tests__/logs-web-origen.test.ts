/**
 * Logs web · origen de cada error (origen.ts). Los casos de
 * logs-web-origen-casos.json pasan TAMBIÉN por el SQL (scripts/test-logs-web.mjs,
 * PGlite): las dos clasificaciones tienen que decir lo mismo.
 */
import { describe, expect, it } from "vitest";
import casos from "./logs-web-origen-casos.json";
import {
  combinarOrigenes,
  explicacionOrigen,
  grupoDeOrigen,
  hostDeUrl,
  motivoSinTicket,
  NOMBRE_ORIGEN,
  origenDeError,
  origenDeOcurrencia,
  proveedorExterno,
  puedeAbrirTicket,
  type DatosOrigen,
  type Origen,
} from "../logs-web/origen.ts";

type Caso = { nombre: string; origen: Origen; proveedor: string | null; datos: DatosOrigen };

describe("origen de cada error (casos compartidos con el SQL)", () => {
  it.each((casos as Caso[]).map((c) => [c.nombre, c] as const))("%s", (_n, c) => {
    expect(origenDeError(c.datos)).toBe(c.origen);
    // El proveedor solo se enseña (y se guarda en la incidencia) si el origen es «externo».
    expect(c.origen === "externo" ? proveedorExterno(c.datos) : null).toBe(c.proveedor);
  });
  it("hay casos de todos los orígenes técnicos", () => {
    const vistos = new Set((casos as Caso[]).map((c) => c.origen));
    expect([...vistos].sort()).toEqual(["conexion", "externo", "navegador", "version_antigua", "web"]);
  });
});

describe("los mensajes de la captura del dueño", () => {
  const captura = ["rest:novedades", "rest:configuracion_web", "rest:tapas", "rest:menus_diarios"].map((endpoint) => ({
    tipo: "error_peticion", fuente: "navegador", mensaje: `Sin respuesta de ${endpoint} (sin conexión)`, objetivo: endpoint, propiedades: { status: 0, endpoint },
  }));
  it("ninguno es un fallo de la web: conexión del visitante", () => {
    for (const d of captura) expect(origenDeError(d)).toBe("conexion");
  });
  it("«Petición sin respuesta (estado 0)» aunque el mensaje no lo diga", () => {
    expect(origenDeError({ tipo: "error_peticion", fuente: "navegador", mensaje: null, propiedades: { status: "0" } })).toBe("conexion");
    expect(origenDeError({ tipo: "error_peticion", fuente: "navegador", mensaje: "HTTP 503 en reservas-web/crear", propiedades: { status: 503 } })).toBe("web");
  });
  it("el texto que ve el dueño", () => {
    expect(NOMBRE_ORIGEN.conexion).toBe("Conexión del visitante");
    expect(explicacionOrigen("conexion")).toMatch(/^No depende de la web: el móvil del visitante se quedó sin cobertura/);
    expect(explicacionOrigen("externo", "Google Maps")).toBe("No es un fallo de nuestro código: depende de Google Maps. Si se repite mucho, hay que mirarlo con ese servicio.");
  });
});

describe("bots, pruebas y tráfico interno", () => {
  const base = { tipo: "error_js", fuente: "navegador", mensaje: "TypeError: x is null" };
  it("van aparte, sea cual sea el mensaje", () => {
    expect(origenDeOcurrencia({ ...base, es_bot: true })).toBe("bots");
    expect(origenDeOcurrencia({ ...base, es_prueba: true })).toBe("bots");
    expect(origenDeOcurrencia({ ...base, es_interno: true })).toBe("bots");
    expect(origenDeOcurrencia(base)).toBe("web");
  });
  it("si el servidor ya lo guardó, manda lo guardado", () => {
    expect(origenDeOcurrencia({ ...base, origen: "navegador" })).toBe("navegador");
    expect(origenDeOcurrencia({ ...base, origen: "rarezas" })).toBe("web");
  });
});

describe("origen de la incidencia (= el CASE del SQL)", () => {
  it("basta una ocurrencia de la web", () => {
    expect(combinarOrigenes({ version_antigua: 9, web: 1 })).toBe("web");
    expect(combinarOrigenes({ conexion: 5, externo: 1 })).toBe("externo");
  });
  it("sin ocurrencias reales: bots y pruebas", () => {
    expect(combinarOrigenes({})).toBe("bots");
  });
  it("entre los que no dependen de la web, el que más se repite", () => {
    expect(combinarOrigenes({ conexion: 2, version_antigua: 1 })).toBe("conexion");
    expect(combinarOrigenes({ conexion: 1, version_antigua: 3 })).toBe("version_antigua");
    expect(combinarOrigenes({ navegador: 1, conexion: 1 })).toBe("navegador");
  });
  it("grupos de color", () => {
    expect(grupoDeOrigen("web")).toBe("web");
    expect(grupoDeOrigen("externo")).toBe("externo");
    for (const o of ["conexion", "navegador", "version_antigua", "bots"] as const) expect(grupoDeOrigen(o)).toBe("no_depende");
    expect(grupoDeOrigen(null)).toBe("web");
  });
});

describe("tickets de Linear", () => {
  it("solo los fallos de la web; los externos si se activa", () => {
    expect(puedeAbrirTicket("web", false)).toBe(true);
    expect(puedeAbrirTicket("externo", false)).toBe(false);
    expect(puedeAbrirTicket("externo", true)).toBe(true);
    for (const o of ["conexion", "navegador", "version_antigua", "bots"]) {
      expect(puedeAbrirTicket(o, false)).toBe(false);
      expect(puedeAbrirTicket(o, true)).toBe(false);
    }
  });
  it("sin la migración (sin origen) sigue como antes", () => {
    expect(puedeAbrirTicket(undefined, false)).toBe(true);
    expect(puedeAbrirTicket(null, false)).toBe(true);
  });
  it("motivo legible", () => {
    expect(motivoSinTicket("externo", "Stripe")).toMatch(/Servicio externo \(Stripe\)/);
    expect(motivoSinTicket("conexion")).toBe("Conexión del visitante: no depende de la web, no abre ticket");
  });
});

describe("host de una URL (igual que el SQL)", () => {
  it("sin www, en minúsculas; las relativas no tienen host", () => {
    expect(hostDeUrl("https://WWW.Ejemplo.com:8080/x?y")).toBe("ejemplo.com");
    expect(hostDeUrl("/assets/x.js")).toBeNull();
    expect(hostDeUrl(null)).toBeNull();
  });
});
