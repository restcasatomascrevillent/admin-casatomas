/**
 * Tests para supabase/functions/emails-reserva/enlaces-web.ts: enlaces de los
 * correos hacia las webs públicas (Supabase sirve el HTML de *.supabase.co
 * como text/plain) y el contrato JSON de /enlace/consultar y /enlace/ejecutar.
 */
import { describe, it, expect } from "vitest";
import {
  basesWeb,
  enlaceRespuestaWeb,
  origenesPermitidos,
  cabecerasCorsEnlace,
  verificarTokenCualquierAccion,
  describirAccion,
  estadoContraoferta,
  estadoPropuesta,
  estadoTrasAceptarPropuesta,
  estadoErrorConfirmarContraoferta,
  respuestaInvalida,
  negocioEnlace,
  tokenDelCuerpo,
  URL_WEB_POR_DEFECTO,
  RUTA_RESPUESTA_WEB,
} from "../enlaces-web.ts";
import { firmarToken, calcularHuella } from "../tokens.ts";

const SECRETO = "secreto-de-prueba";
const BASES = basesWeb({});

describe("basesWeb", () => {
  it("usa las webs por defecto sin env", () => {
    expect(BASES).toEqual(URL_WEB_POR_DEFECTO);
    expect(BASES.casa_tomas).toBe("https://restaurantecasatomascrevillente.es");
    expect(BASES.touza).toBe("https://touza-restaurant-website.vercel.app");
  });

  it("acepta las env y quita la barra final", () => {
    const b = basesWeb({ casaTomas: "https://ct.example.com/", touza: " https://touza.example.com// " });
    expect(b).toEqual({ casa_tomas: "https://ct.example.com", touza: "https://touza.example.com" });
  });

  it("ignora valores vacíos o que no son URL http(s)", () => {
    const b = basesWeb({ casaTomas: "", touza: "javascript:alert(1)" });
    expect(b).toEqual(URL_WEB_POR_DEFECTO);
  });
});

describe("enlaceRespuestaWeb", () => {
  it("apunta a la web del negocio con el token codificado", () => {
    expect(enlaceRespuestaWeb(BASES, "casa_tomas", "a.b+c/=")).toBe(
      `https://restaurantecasatomascrevillente.es${RUTA_RESPUESTA_WEB}?token=a.b%2Bc%2F%3D`,
    );
    expect(enlaceRespuestaWeb(BASES, "touza", "tok")).toBe("https://touza-restaurant-website.vercel.app/reserva/respuesta?token=tok");
  });

  it("marca desconocida o nula => Casa Tomás", () => {
    expect(enlaceRespuestaWeb(BASES, null, "t")).toMatch(/^https:\/\/restaurantecasatomascrevillente\.es\//);
    expect(enlaceRespuestaWeb(BASES, "otra", "t")).toMatch(/^https:\/\/restaurantecasatomascrevillente\.es\//);
  });

  it("nunca apunta al dominio de funciones de Supabase", () => {
    expect(enlaceRespuestaWeb(BASES, "touza", "t")).not.toContain("supabase.co");
  });
});

describe("CORS de /enlace/*", () => {
  const permitidos = origenesPermitidos(BASES, "http://localhost:8080, https://preview.vercel.app/ruta, basura");

  it("incluye las dos webs, su variante www y los extra (solo el origen)", () => {
    expect(permitidos).toContain("https://restaurantecasatomascrevillente.es");
    expect(permitidos).toContain("https://www.restaurantecasatomascrevillente.es");
    expect(permitidos).toContain("https://touza-restaurant-website.vercel.app");
    expect(permitidos).toContain("http://localhost:8080");
    expect(permitidos).toContain("https://preview.vercel.app");
    expect(permitidos).not.toContain("basura");
  });

  it("refleja solo un origen permitido", () => {
    expect(cabecerasCorsEnlace("https://touza-restaurant-website.vercel.app", permitidos)["Access-Control-Allow-Origin"]).toBe(
      "https://touza-restaurant-website.vercel.app",
    );
    expect(cabecerasCorsEnlace("https://evil.example", permitidos)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(cabecerasCorsEnlace(null, permitidos)["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(cabecerasCorsEnlace(null, permitidos).Vary).toBe("Origin");
  });
});

describe("verificarTokenCualquierAccion + describirAccion", () => {
  it("reconoce cada una de las 4 acciones", async () => {
    for (const accion of ["aceptar", "rechazar", "aceptar_solicitud", "rechazar_solicitud"] as const) {
      const token = await firmarToken(SECRETO, "id-1", accion, "fp");
      const carga = await verificarTokenCualquierAccion(SECRETO, token);
      expect(carga?.accion).toBe(accion);
      expect(carga?.id).toBe("id-1");
    }
  });

  it("rechaza firma mala, caducado, vacío, secreto vacío y tokens enormes", async () => {
    const token = await firmarToken(SECRETO, "id-1", "aceptar", "fp", 1000);
    expect(await verificarTokenCualquierAccion("otro", token, 1001)).toBeNull();
    expect(await verificarTokenCualquierAccion(SECRETO, token, 1000 + 60 * 60 * 24 * 15)).toBeNull();
    expect(await verificarTokenCualquierAccion(SECRETO, "")).toBeNull();
    expect(await verificarTokenCualquierAccion("", token, 1001)).toBeNull();
    expect(await verificarTokenCualquierAccion(SECRETO, "x".repeat(5000))).toBeNull();
  });

  it("traduce la acción del token a flujo + acción de la web", () => {
    expect(describirAccion("aceptar")).toEqual({ tipo: "contraoferta", accion: "aceptar" });
    expect(describirAccion("rechazar")).toEqual({ tipo: "contraoferta", accion: "rechazar" });
    expect(describirAccion("aceptar_solicitud")).toEqual({ tipo: "propuesta", accion: "aceptar" });
    expect(describirAccion("rechazar_solicitud")).toEqual({ tipo: "propuesta", accion: "rechazar" });
  });
});

describe("estadoContraoferta", () => {
  const reserva = { estado: "verificada", hora: "21:00:00", espacio_id: "esp-1" };
  const huella = calcularHuella("verificada", "21:00");

  it("pendiente si sigue verificada con la misma huella", () => {
    expect(estadoContraoferta("aceptar", reserva, huella)).toBe("pendiente");
    expect(estadoContraoferta("rechazar", reserva, huella)).toBe("pendiente");
  });

  it("inválido si el restaurante cambió la hora", () => {
    expect(estadoContraoferta("aceptar", { ...reserva, hora: "21:30" }, huella)).toBe("invalido");
  });

  it("asignar o cambiar la sala NO invalida el enlace (la sala es interna)", () => {
    expect(estadoContraoferta("aceptar", { ...reserva, espacio_id: "esp-2" }, huella)).toBe("pendiente");
    expect(estadoContraoferta("aceptar", { estado: "verificada", hora: "21:00" }, huella)).toBe("pendiente");
  });

  it("enlace antiguo (estado|hora|sala) sigue valiendo tras cambiar la sala, no tras cambiar la hora", () => {
    const legado = "verificada|21:00|esp-1";
    expect(estadoContraoferta("aceptar", { ...reserva, espacio_id: "esp-2" }, legado)).toBe("pendiente");
    expect(estadoContraoferta("rechazar", { ...reserva, espacio_id: null }, legado)).toBe("pendiente");
    expect(estadoContraoferta("aceptar", { ...reserva, hora: "22:00" }, legado)).toBe("invalido");
  });

  it("ya_hecho: aceptar sobre confirmada, rechazar sobre cancelada", () => {
    expect(estadoContraoferta("aceptar", { ...reserva, estado: "confirmada" }, huella)).toBe("ya_hecho");
    expect(estadoContraoferta("rechazar", { ...reserva, estado: "cancelada" }, huella)).toBe("ya_hecho");
  });

  it("aceptar sobre cancelada o rechazar sobre confirmada => inválido", () => {
    expect(estadoContraoferta("aceptar", { ...reserva, estado: "cancelada" }, huella)).toBe("invalido");
    expect(estadoContraoferta("rechazar", { ...reserva, estado: "confirmada" }, huella)).toBe("invalido");
  });
});

describe("estadoPropuesta / estadoTrasAceptarPropuesta", () => {
  it("consulta", () => {
    expect(estadoPropuesta("aceptar", "enviada", true)).toBe("pendiente");
    expect(estadoPropuesta("aceptar", "enviada", false)).toBe("invalido");
    expect(estadoPropuesta("aceptar", "aceptada", false)).toBe("ya_hecho");
    expect(estadoPropuesta("rechazar", "rechazada", false)).toBe("ya_hecho");
    expect(estadoPropuesta("rechazar", "aceptada", false)).toBe("invalido");
  });

  it("resultado de fn_aceptar_propuesta_solicitud", () => {
    expect(estadoTrasAceptarPropuesta({ ok: true, estado: "confirmada" })).toBe("hecho");
    expect(estadoTrasAceptarPropuesta({ ok: true, estado: "pendiente" })).toBe("recibida");
    expect(estadoTrasAceptarPropuesta({ ok: true, ya_aceptada: true, estado: "confirmada" })).toBe("ya_hecho");
    expect(estadoTrasAceptarPropuesta({ ok: false, error: "sin_aforo" })).toBe("sin_aforo");
    expect(estadoTrasAceptarPropuesta({ ok: false, error: "fecha_pasada" })).toBe("fecha_pasada");
    expect(estadoTrasAceptarPropuesta({ ok: false, error: "propuesta_no_vigente" })).toBe("invalido");
    expect(estadoTrasAceptarPropuesta({ ok: false, error: "otra_cosa" })).toBe("error");
    expect(estadoTrasAceptarPropuesta(null)).toBe("error");
  });

  it("error al confirmar una contraoferta: aforo vs otro", () => {
    expect(estadoErrorConfirmarContraoferta("23514", "check")).toBe("sin_aforo");
    expect(estadoErrorConfirmarContraoferta("P0001", "Aforo completo")).toBe("sin_aforo");
    expect(estadoErrorConfirmarContraoferta("42501", "permiso")).toBe("error");
  });
});

describe("respuestas", () => {
  it("inválida no lleva datos y sí el negocio para el teléfono", () => {
    const r = respuestaInvalida(BASES, "touza");
    expect(r).toMatchObject({ ok: false, estado: "invalido", detalles: null, tipo: null, accion: null });
    expect(r.negocio).toEqual({
      marca: "touza",
      nombre: "Touza",
      telefonoTexto: "966 782 000",
      telefonoDigits: "966782000",
      web: "https://touza-restaurant-website.vercel.app",
    });
  });

  it("negocio por defecto = Casa Tomás", () => {
    expect(negocioEnlace(undefined, BASES).nombre).toBe("Casa Tomás");
  });

  it("tokenDelCuerpo", () => {
    expect(tokenDelCuerpo({ token: "abc" })).toBe("abc");
    expect(tokenDelCuerpo({ token: "" })).toBeNull();
    expect(tokenDelCuerpo({ token: 1 })).toBeNull();
    expect(tokenDelCuerpo(null)).toBeNull();
    expect(tokenDelCuerpo({ token: "x".repeat(3000) })).toBeNull();
  });
});
