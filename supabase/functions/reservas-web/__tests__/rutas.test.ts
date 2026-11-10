/**
 * Tests de supabase/functions/reservas-web/rutas.ts
 *
 * Qué fallo cubren: `POST /notificar-estado` mandaba correos "Estado de
 * reserva" (confirma asistencia / sin disponibilidad) a cualquier reserva y
 * su única guarda fallaba ABIERTO sin `RESERVAS_WEB_SHARED_SECRET`, que no
 * está definido en producción. Se retira (2026-09-30): ahora es 404.
 *
 * Y lo que NO debe cambiar: las rutas públicas de la web (/disponibilidad,
 * /crear) y los enlaces de correo (/confirmar, /cancelar,
 * /cancelar/ejecutar, autenticados por su token HMAC) siguen respondiendo, y
 * las dos POST siguen funcionando SIN el secreto compartido.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolverRuta, rutaDelPath, secretoCompartidoValido, RUTAS_RESERVAS_WEB } from "../rutas.ts";

const BASE = "/functions/v1/reservas-web";

describe("/notificar-estado — retirada", () => {
  it.each(["POST", "GET"])("%s /notificar-estado no resuelve a ninguna ruta (-> 404)", (metodo) => {
    expect(resolverRuta(metodo, `${BASE}/notificar-estado`)).toBeNull();
    expect(resolverRuta(metodo, "/reservas-web/notificar-estado")).toBeNull();
    expect(resolverRuta(metodo, "/notificar-estado")).toBeNull();
  });

  it("tampoco con barra final ni con variantes de mayúsculas", () => {
    expect(resolverRuta("POST", `${BASE}/notificar-estado/`)).toBeNull();
    expect(resolverRuta("POST", `${BASE}/Notificar-Estado`)).toBeNull();
  });

  it("no queda en la tabla de rutas", () => {
    expect(RUTAS_RESERVAS_WEB.map((r) => r.ruta)).not.toContain("notificar-estado");
  });

  it("index.ts ya no tiene el handler, ni firma tokens, ni enruta a mano (usa la tabla)", () => {
    const fuente = readFileSync(resolve(__dirname, "../index.ts"), "utf-8");
    expect(fuente).not.toContain("handleNotificarEstado");
    expect(fuente).not.toContain("signReservaToken(");
    expect(fuente).not.toMatch(/route === "notificar-estado"/);
    expect(fuente).toContain("resolverRuta(req.method, pathname)");
  });
});

describe("rutas públicas — sin cambios", () => {
  it.each([
    ["POST", "disponibilidad"],
    ["POST", "crear"],
    ["POST", "cierres"],
    ["GET", "confirmar"],
    ["GET", "cancelar"],
    ["GET", "cancelar/ejecutar"],
    ["GET", "salud"],
  ] as const)("%s /%s resuelve con el path completo de Supabase", (metodo, ruta) => {
    expect(resolverRuta(metodo, `${BASE}/${ruta}`)).toBe(ruta);
  });

  it("GET /salud resuelve (sonda de keep-warm) y POST /salud es 404", () => {
    expect(resolverRuta("GET", `${BASE}/salud`)).toBe("salud");
    expect(resolverRuta("GET", "/reservas-web/salud")).toBe("salud");
    expect(resolverRuta("POST", `${BASE}/salud`)).toBeNull();
  });

  it("resuelve igual sin el prefijo /functions/v1 (lo que ve la función en local)", () => {
    expect(resolverRuta("POST", "/reservas-web/crear")).toBe("crear");
    expect(resolverRuta("GET", "/reservas-web/cancelar/ejecutar")).toBe("cancelar/ejecutar");
  });

  it("el método sigue importando: GET /crear o POST /confirmar son 404", () => {
    expect(resolverRuta("GET", `${BASE}/crear`)).toBeNull();
    expect(resolverRuta("GET", `${BASE}/disponibilidad`)).toBeNull();
    expect(resolverRuta("POST", `${BASE}/confirmar`)).toBeNull();
    expect(resolverRuta("POST", `${BASE}/cancelar/ejecutar`)).toBeNull();
  });

  it("la tabla de rutas: las POST públicas, los GET de correo y GET /salud (keep-warm, CT-REM-FN-07c)", () => {
    expect(RUTAS_RESERVAS_WEB).toEqual([
      { metodo: "POST", ruta: "disponibilidad" },
      { metodo: "POST", ruta: "crear" },
      { metodo: "POST", ruta: "cierres" },
      { metodo: "GET", ruta: "confirmar" },
      { metodo: "GET", ruta: "cancelar" },
      { metodo: "GET", ruta: "cancelar/ejecutar" },
      { metodo: "GET", ruta: "salud" },
    ]);
  });

  it("rutaDelPath devuelve lo que va detrás de reservas-web (para el cuerpo del 404)", () => {
    expect(rutaDelPath(`${BASE}/notificar-estado`)).toBe("notificar-estado");
    expect(rutaDelPath(`${BASE}/cancelar/ejecutar`)).toBe("cancelar/ejecutar");
    expect(rutaDelPath(`${BASE}`)).toBe("");
  });
});

describe("secretoCompartidoValido — /disponibilidad y /crear siguen sin necesitar secreto", () => {
  it("sin secreto configurado (producción hoy) deja pasar, con o sin cabecera", () => {
    expect(secretoCompartidoValido("", null)).toBe(true);
    expect(secretoCompartidoValido("", "lo-que-sea")).toBe(true);
  });

  it("con secreto configurado exige la cabecera exacta", () => {
    expect(secretoCompartidoValido("s3cr3t", "s3cr3t")).toBe(true);
    expect(secretoCompartidoValido("s3cr3t", null)).toBe(false);
    expect(secretoCompartidoValido("s3cr3t", "")).toBe(false);
    expect(secretoCompartidoValido("s3cr3t", "otro")).toBe(false);
  });

  it("index.ts solo la usa en las tres rutas POST públicas (/cierres, 2026-10-13: solo lectura)", () => {
    const fuente = readFileSync(resolve(__dirname, "../index.ts"), "utf-8");
    const usos = fuente.match(/if \(!checkSharedSecret\(req\)\)/g) ?? [];
    expect(usos).toHaveLength(3);
  });
});
