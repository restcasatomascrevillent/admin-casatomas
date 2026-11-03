import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VersionPanel } from "../VersionPanel";
import type { VersionApp } from "@/lib/version";

const base: VersionApp = { version: "0.12", mayor: 0, numero: 12, commit: "abc1234", rama: "staging", entorno: "demo", aviso: null };

describe("VersionPanel", () => {
  it("muestra la versión y si es la demo o producción, con el commit al pasar el ratón", () => {
    const { rerender } = render(<VersionPanel version={base} />);
    const panel = screen.getByTestId("version-panel");
    expect(panel).toHaveTextContent("v0.12·Demo");
    expect(panel).toHaveAttribute("data-entorno", "demo");
    expect(panel).toHaveAttribute("title", "v0.12 · Demo · Commit abc1234");
    expect(panel.className).toContain("bg-status-pending");
    rerender(<VersionPanel version={{ ...base, rama: "main", entorno: "produccion" }} />);
    expect(screen.getByText("Producción")).toBeTruthy();
    expect(screen.getByTestId("version-panel").className).toContain("bg-status-confirmed");
  });

  it("con el menú plegado solo enseña el número (el entorno, en el tooltip y para el lector)", () => {
    render(<VersionPanel version={base} colapsado />);
    const panel = screen.getByTestId("version-panel");
    expect(panel.querySelector(".font-mono")).toHaveTextContent(/^v0\.12$/);
    expect(panel.querySelector(".sr-only")).toHaveTextContent("Demo");
    expect(panel).toHaveAttribute("title", "v0.12 · Demo · Commit abc1234");
  });

  it("explica por qué falta el número", () => {
    render(<VersionPanel version={{ ...base, version: "0.?", numero: null, aviso: "historial de git incompleto" }} />);
    expect(screen.getByTestId("version-panel")).toHaveAttribute("title", "v0.? · Demo · Commit abc1234 · historial de git incompleto");
  });

  it("sin build (local) solo dice el entorno", () => {
    render(<VersionPanel version={{ ...base, version: "local", numero: null, commit: null, entorno: "local" }} />);
    expect(screen.getByTestId("version-panel")).toHaveTextContent(/^Local$/);
    expect(screen.getByTestId("version-panel")).toHaveAttribute("title", "Local");
  });
});
