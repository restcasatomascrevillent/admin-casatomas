import { describe, expect, it } from "vitest";
import { estadoDespliegue } from "../esperar-despliegue.mjs";

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
});
