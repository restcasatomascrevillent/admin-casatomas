import { afterEach, describe, expect, it, vi } from "vitest";
import { esperar, estadoDespliegue, estadoVercel, resolverEspera } from "../esperar-despliegue.mjs";

const d = (environment, created_at, estados) => ({ environment, created_at, estados });

describe("estado del despliegue de Vercel de un commit", () => {
  it("devuelve la URL cuando el último despliegue del entorno ha terminado bien", () => {
    const lista = [
      d("Preview", "2026-11-09T10:00:00Z", [{ state: "failure" }]),
      d("Preview – web-casatomas", "2026-11-09T10:05:00Z", [{ state: "success", environment_url: "https://web-casatomas-abc.vercel.app" }, { state: "pending" }]),
      d("Production", "2026-11-09T10:06:00Z", [{ state: "success", environment_url: "https://prod" }]),
    ];
    expect(estadoDespliegue(lista, "Preview")).toEqual({ estado: "listo", url: "https://web-casatomas-abc.vercel.app" });
    expect(estadoDespliegue(lista, "Production")).toEqual({ estado: "listo", url: "https://prod" });
  });
  it("espera si no hay despliegue o sigue en marcha, y avisa si falla", () => {
    expect(estadoDespliegue([], "Preview")).toEqual({ estado: "esperando" });
    expect(estadoDespliegue([d("Preview", "2026-11-09T10:00:00Z", [{ state: "in_progress" }])], "Preview")).toEqual({ estado: "esperando" });
    expect(estadoDespliegue([d("Preview", "2026-11-09T10:00:00Z", [{ state: "error", description: "Build failed" }])], "Preview")).toEqual({ estado: "fallido", detalle: "error: Build failed" });
  });
  it("solo mira el entorno pedido (sin distinguir mayúsculas) y, dentro de él, el despliegue más reciente", () => {
    const soloProduccion = [d("Production", "2026-11-09T10:06:00Z", [{ state: "success", environment_url: "https://prod" }])];
    expect(estadoDespliegue(soloProduccion, "Preview")).toEqual({ estado: "esperando" });
    expect(estadoDespliegue(soloProduccion, "production")).toEqual({ estado: "listo", url: "https://prod" });
    const reintento = [
      d("Preview", "2026-11-09T10:10:00Z", [{ state: "success", environment_url: "https://nuevo" }]),
      d("Preview", "2026-11-09T10:00:00Z", [{ state: "error" }]),
    ];
    expect(estadoDespliegue(reintento, "Preview")).toEqual({ estado: "listo", url: "https://nuevo" });
    expect(estadoDespliegue([...reintento].reverse(), "Preview")).toEqual({ estado: "listo", url: "https://nuevo" });
  });
  it("un despliegue recién creado, sin estados todavía, sigue esperando; uno retirado cuenta como fallido", () => {
    expect(estadoDespliegue([d("Preview", "2026-11-09T10:00:00Z", [])], "Preview")).toEqual({ estado: "esperando" });
    expect(estadoDespliegue([d("Preview", "2026-11-09T10:00:00Z", undefined)], "Preview")).toEqual({ estado: "esperando" });
    expect(estadoDespliegue([d("Preview", "2026-11-09T10:00:00Z", [{ state: "inactive" }])], "Preview")).toEqual({ estado: "fallido", detalle: "inactive" });
  });
  it("sin environment_url usa target_url, y sin ninguna de las dos no inventa una URL", () => {
    expect(estadoDespliegue([d("Preview", "2026-11-09T10:00:00Z", [{ state: "success", target_url: "https://destino" }])], "Preview")).toEqual({ estado: "listo", url: "https://destino" });
    expect(estadoDespliegue([d("Preview", "2026-11-09T10:00:00Z", [{ state: "success" }])], "Preview")).toEqual({ estado: "listo", url: null });
  });
});

describe("estado «Vercel» del commit (lo que hay cuando Vercel no crea deployments en GitHub)", () => {
  const listo = { state: "success", context: "Vercel", description: "Deployment has completed", target_url: "https://vercel.com/casa-tomas/web-casatomas/AKKn" };
  it("lee el estado del contexto «Vercel» y no hace caso de los demás", () => {
    expect(estadoVercel([listo], "web-casatomas")).toEqual({ estado: "listo" });
    expect(estadoVercel([{ state: "pending", context: "Vercel" }], "web-casatomas")).toEqual({ estado: "esperando" });
    expect(estadoVercel([{ state: "success", context: "ci/otra-cosa" }, { state: "success", context: "Vercel Preview Comments" }], "web-casatomas")).toEqual({ estado: "esperando" });
    expect(estadoVercel([], "web-casatomas")).toEqual({ estado: "esperando" });
    expect(estadoVercel(undefined, "web-casatomas")).toEqual({ estado: "esperando" });
  });
  it("si el build falla lo dice con el motivo y el enlace al despliegue en Vercel", () => {
    expect(estadoVercel([{ state: "failure", context: "Vercel", description: "Deployment has failed", target_url: "https://vercel.com/casa-tomas/web-casatomas/XyZ" }], "web-casatomas")).toEqual({
      estado: "fallido",
      detalle: "Vercel: failure: Deployment has failed (https://vercel.com/casa-tomas/web-casatomas/XyZ)",
    });
    expect(estadoVercel([{ state: "error", context: "Vercel" }], "web-casatomas")).toEqual({ estado: "fallido", detalle: "Vercel: error" });
  });
  it("con varios proyectos de Vercel en el repo se queda con el suyo", () => {
    const varios = [{ state: "failure", context: "Vercel – otro-proyecto" }, { state: "success", context: "Vercel – web-casatomas" }];
    expect(estadoVercel(varios, "web-casatomas")).toEqual({ estado: "listo" });
    expect(estadoVercel(varios, "otro-proyecto").estado).toBe("fallido");
  });
});

describe("juntar las señales de una vuelta", () => {
  const esperando = { estado: "esperando" };
  const url = "https://web-casatomas-git-release-1120-casa-tomas.vercel.app";
  it("si la URL ya sirve el commit está listo, digan lo que digan las demás", () => {
    expect(resolverEspera({ sirve: true, url, github: esperando, vercel: esperando })).toEqual({ estado: "listo", url });
    expect(resolverEspera({ sirve: true, url, github: esperando, vercel: { estado: "fallido", detalle: "x" } })).toEqual({ estado: "listo", url });
  });
  it("con el estado «Vercel» en verde da la URL de la rama; con un deployment de GitHub, la suya", () => {
    expect(resolverEspera({ sirve: false, url, github: esperando, vercel: { estado: "listo" } })).toEqual({ estado: "listo", url });
    expect(resolverEspera({ sirve: false, url, github: { estado: "listo", url: "https://unica" }, vercel: esperando })).toEqual({ estado: "listo", url: "https://unica" });
    expect(resolverEspera({ sirve: false, url, github: { estado: "listo", url: null }, vercel: esperando })).toEqual({ estado: "listo", url });
  });
  it("un fallo de cualquiera de las dos corta la espera; sin nada, sigue esperando", () => {
    expect(resolverEspera({ sirve: false, url, github: esperando, vercel: { estado: "fallido", detalle: "Vercel: failure" } })).toEqual({ estado: "fallido", detalle: "Vercel: failure" });
    expect(resolverEspera({ sirve: false, url, github: { estado: "fallido", detalle: "error: Build failed" }, vercel: { estado: "listo" } })).toEqual({ estado: "fallido", detalle: "error: Build failed" });
    expect(resolverEspera({ sirve: false, url, github: esperando, vercel: esperando })).toEqual({ estado: "esperando" });
  });
});

describe("esperar la preview de una release (peticiones simuladas)", () => {
  const SHA = "49e44170f80f0d7798978b4357b50b5f24f974cc";
  const ALIAS = "https://web-casatomas-git-release-1120-casa-tomas.vercel.app";
  const base = { repo: "restcasatomascrevillent/web-casatomas", sha: SHA, entorno: "Preview", rama: "release/1.12.0", pausaMs: 0, avisar: () => {} };
  const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

  /** Simula GitHub y el sitio. Cada opción es lo que contesta esa parte (o un número: ese error HTTP). */
  function simular({ despliegues = [], estadosDespliegue = [], estados = [], version = null } = {}) {
    const pedidas = [];
    vi.stubGlobal("fetch", async (entrada) => {
      const u = String(entrada);
      pedidas.push(u);
      const responder = (valor) => (typeof valor === "number" ? json({ message: "error" }, valor) : json(valor));
      if (u.includes("/deployments?")) return responder(despliegues);
      if (/\/deployments\/\d+\/statuses/.test(u)) return responder(estadosDespliegue);
      if (u.includes(`/commits/${SHA}/status`)) return responder(typeof estados === "number" ? estados : { state: "success", statuses: estados });
      if (u.startsWith(`${ALIAS}/version.json`)) return version ? json(version) : json({ error: "DEPLOYMENT_NOT_FOUND" }, 404);
      if (u === `${ALIAS}/`) return version ? new Response("<html></html>", { status: 200 }) : new Response("no", { status: 404 });
      throw new Error(`petición inesperada: ${u}`);
    });
    return pedidas;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("sin deployments en GitHub (Vercel no los crea) encuentra la preview por el estado «Vercel» y la URL de la rama", async () => {
    // Lo que había en el PR de la v1.12.0: ningún deployment y el estado «Vercel» en verde.
    simular({ despliegues: [], estados: [{ state: "success", context: "Vercel", description: "Deployment has completed" }] });
    expect(await esperar({ ...base, minutos: 20 })).toEqual({ estado: "listo", url: ALIAS });
  });

  it("si GitHub no deja leer nada (403) le basta con que la URL de la rama sirva ese commit", async () => {
    const avisos = [];
    const pedidas = simular({ despliegues: 403, estados: 403, version: { version: "1.12.0", commit: "49e4417" } });
    expect(await esperar({ ...base, minutos: 20, avisar: (t) => avisos.push(t) })).toEqual({ estado: "listo", url: ALIAS });
    expect(pedidas.some((u) => u.startsWith(`${ALIAS}/version.json`))).toBe(true);
    expect(avisos.join("\n")).toMatch(/no se puede leer los deployments de GitHub \(GitHub 403/);
    expect(avisos.join("\n")).toMatch(/no se puede leer el estado «Vercel» del commit \(GitHub 403/);
  });

  it("no da por buena una URL de la rama que sirve otro commit", async () => {
    simular({ version: { version: "1.12.0", commit: "fff0000" } });
    const res = await esperar({ ...base, minutos: 0 });
    expect(res.estado).toBe("fallido");
    expect(res.url).toBe(ALIAS);
    expect(res.detalle).toBe(`Vercel no terminó el despliegue de Preview en 0 minutos (${ALIAS} no sirve el commit 49e4417)`);
  });

  it("si el build de Vercel falla lo dice a la primera, sin agotar el plazo", async () => {
    simular({ estados: [{ state: "failure", context: "Vercel", description: "Deployment has failed", target_url: "https://vercel.com/casa-tomas/web-casatomas/XyZ" }] });
    expect(await esperar({ ...base, minutos: 20 })).toEqual({ estado: "fallido", detalle: "Vercel: failure: Deployment has failed (https://vercel.com/casa-tomas/web-casatomas/XyZ)" });
  });

  it("si Vercel sí crea el deployment en GitHub, usa su URL", async () => {
    simular({
      despliegues: [{ id: 7, environment: "Preview", created_at: "2026-11-14T10:57:10Z" }],
      estadosDespliegue: [{ state: "success", environment_url: "https://web-casatomas-3czt4m0c3-casa-tomas.vercel.app" }],
    });
    expect(await esperar({ ...base, minutos: 20 })).toEqual({ estado: "listo", url: "https://web-casatomas-3czt4m0c3-casa-tomas.vercel.app" });
  });

  it("en producción comprueba la URL que se le pasa", async () => {
    const pedidas = [];
    vi.stubGlobal("fetch", async (entrada) => {
      const u = String(entrada);
      pedidas.push(u);
      if (u.startsWith("https://web-casatomas.vercel.app/version.json")) return json({ version: "1.12.0", commit: SHA.slice(0, 7) });
      if (u === "https://web-casatomas.vercel.app/") return new Response("<html></html>", { status: 200 });
      if (u.includes("/deployments?")) return json([]);
      return json({ state: "pending", statuses: [] });
    });
    expect(await esperar({ ...base, entorno: "Production", rama: undefined, url: "https://web-casatomas.vercel.app/", minutos: 20 })).toEqual({ estado: "listo", url: "https://web-casatomas.vercel.app" });
    expect(pedidas.some((u) => u.includes("-git-"))).toBe(false);
  });
});
