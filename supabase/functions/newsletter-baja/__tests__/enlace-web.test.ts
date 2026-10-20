/**
 * Tests para supabase/functions/newsletter-baja/enlace-web.ts: el enlace de
 * baja del newsletter va a la web de Casa Tomás (Supabase sirve el HTML de
 * *.supabase.co como text/plain) y la web habla con la función en JSON.
 */
import { describe, it, expect } from "vitest";
import { baseBajaWeb, urlBajaWeb, quiereJson, respuestaBaja, URL_BAJA_WEB_POR_DEFECTO } from "../enlace-web.ts";

describe("baseBajaWeb", () => {
  it("por defecto, la página de la web de Casa Tomás", () => {
    expect(baseBajaWeb(undefined)).toBe("https://restaurantecasatomascrevillente.es/newsletter/baja");
    expect(baseBajaWeb("")).toBe(URL_BAJA_WEB_POR_DEFECTO);
    expect(baseBajaWeb("ftp://x")).toBe(URL_BAJA_WEB_POR_DEFECTO);
  });
  it("acepta env y quita la barra final", () => {
    expect(baseBajaWeb("https://preview.vercel.app/newsletter/baja/")).toBe("https://preview.vercel.app/newsletter/baja");
  });
});

describe("urlBajaWeb", () => {
  it("lleva sid, via y sig codificados y nunca el dominio de funciones", () => {
    const url = urlBajaWeb(URL_BAJA_WEB_POR_DEFECTO, "11111111-2222-3333-4444-555555555555", "body", "a-b_c");
    expect(url).toBe(
      "https://restaurantecasatomascrevillente.es/newsletter/baja?sid=11111111-2222-3333-4444-555555555555&via=body&sig=a-b_c",
    );
    expect(url).not.toContain("supabase.co");
  });
});

describe("quiereJson", () => {
  it("solo con formato=json", () => {
    expect(quiereJson(new URL("https://x/f?sid=1&formato=json"))).toBe(true);
    expect(quiereJson(new URL("https://x/f?sid=1"))).toBe(false);
  });
});

describe("respuestaBaja", () => {
  it("no devuelve el email en inválido/error", () => {
    expect(respuestaBaja("invalido", "a@b.c")).toEqual({ ok: false, estado: "invalido", email: null, fecha_baja: null });
    expect(respuestaBaja("error", "a@b.c").email).toBeNull();
  });
  it("confirmar / baja_hecha / ya_estaba son ok", () => {
    expect(respuestaBaja("confirmar", "a@b.c")).toMatchObject({ ok: true, email: "a@b.c" });
    expect(respuestaBaja("baja_hecha", "a@b.c", "2026-09-24T10:00:00Z")).toMatchObject({ ok: true, fecha_baja: "2026-09-24T10:00:00Z" });
    expect(respuestaBaja("ya_estaba", "a@b.c").ok).toBe(true);
  });
});
