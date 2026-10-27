import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VersionPanel } from "../VersionPanel";
import type { VersionApp } from "@/lib/version";

const base: VersionApp = { version: "0.12", mayor: 0, numero: 12, commit: "abc1234", rama: "staging", entorno: "demo", aviso: null };

describe("VersionPanel", () => {
  it("muestra la versión y si es la demo o producción", () => {
    const { rerender } = render(<VersionPanel version={base} />);
    expect(screen.getByTestId("version-panel")).toHaveTextContent("v0.12Demo");
    expect(screen.getByTestId("version-panel")).toHaveAttribute("title", "Commit abc1234");
    rerender(<VersionPanel version={{ ...base, rama: "main", entorno: "produccion" }} />);
    expect(screen.getByText("Producción")).toBeTruthy();
  });
  it("con el menú plegado solo enseña el número", () => {
    render(<VersionPanel version={base} colapsado />);
    expect(screen.getByTestId("version-panel")).toHaveTextContent(/^v0\.12$/);
  });
  it("explica por qué falta el número", () => {
    render(<VersionPanel version={{ ...base, version: "0.?", numero: null, aviso: "historial de git incompleto" }} />);
    expect(screen.getByTestId("version-panel")).toHaveAttribute("title", "Commit abc1234 · historial de git incompleto");
  });
});
