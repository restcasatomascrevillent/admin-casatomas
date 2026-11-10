import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VersionPanel } from "../VersionPanel";
import type { VersionApp } from "@/lib/version";

const demo: VersionApp = { version: "1.2.0+abc1234", publicada: "1.2.0", desarrollo: true, commit: "abc1234", rama: "staging", entorno: "demo", aviso: null };
const produccion: VersionApp = { version: "1.2.0", publicada: "1.2.0", desarrollo: false, commit: "def5678", rama: "main", entorno: "produccion", aviso: null };

describe("VersionPanel", () => {
  it("en la demo: la última publicada y, al pasar el ratón, la versión entera, que lleva cambios sin publicar y el commit", () => {
    render(<VersionPanel version={demo} />);
    const panel = screen.getByTestId("version-panel");
    expect(panel).toHaveTextContent("v1.2.0·Demo");
    expect(panel).toHaveAttribute("data-entorno", "demo");
    expect(panel).toHaveAttribute("title", "v1.2.0+abc1234 · Demo · cambios sin publicar sobre la v1.2.0 · Commit abc1234");
    expect(panel.className).toContain("bg-status-pending");
  });

  it("en producción y en la candidata: la versión exacta de la publicación", () => {
    const { rerender } = render(<VersionPanel version={produccion} />);
    expect(screen.getByTestId("version-panel")).toHaveTextContent("v1.2.0·Producción");
    expect(screen.getByTestId("version-panel")).toHaveAttribute("title", "v1.2.0 · Producción · Commit def5678");
    expect(screen.getByTestId("version-panel").className).toContain("bg-status-confirmed");
    rerender(<VersionPanel version={{ ...produccion, version: "1.3.0", publicada: "1.3.0", rama: "release/1.3.0", entorno: "preview" }} />);
    expect(screen.getByTestId("version-panel")).toHaveTextContent("v1.3.0·Preview");
  });

  it("con el menú plegado solo enseña el número (el entorno, en el tooltip y para el lector)", () => {
    render(<VersionPanel version={demo} colapsado />);
    const panel = screen.getByTestId("version-panel");
    expect(panel.querySelector(".font-mono")).toHaveTextContent(/^v1\.2\.0$/);
    expect(panel.querySelector(".sr-only")).toHaveTextContent("Demo");
  });

  it("en la transición desde 0.N la etiqueta no crece: 0.403.0 se ve como v0.403", () => {
    render(<VersionPanel version={{ ...demo, version: "0.403.0+abc1234", publicada: "0.403.0" }} colapsado />);
    expect(screen.getByTestId("version-panel").querySelector(".font-mono")).toHaveTextContent(/^v0\.403$/);
    expect(screen.getByTestId("version-panel")).toHaveAttribute("title", "v0.403.0+abc1234 · Demo · cambios sin publicar sobre la v0.403.0 · Commit abc1234");
  });

  it("explica por qué falta la versión", () => {
    render(<VersionPanel version={{ ...demo, version: "sin versionar", publicada: null, aviso: 'falta "version": "X.Y.Z" en versionado.json' }} />);
    expect(screen.getByTestId("version-panel")).toHaveAttribute("title", 'sin versionar · Demo · Commit abc1234 · falta "version": "X.Y.Z" en versionado.json');
  });

  it("sin build (local) solo dice el entorno", () => {
    render(<VersionPanel version={{ ...demo, version: "local", publicada: null, commit: null, entorno: "local" }} />);
    expect(screen.getByTestId("version-panel")).toHaveTextContent(/^Local$/);
    expect(screen.getByTestId("version-panel")).toHaveAttribute("title", "Local");
  });
});
