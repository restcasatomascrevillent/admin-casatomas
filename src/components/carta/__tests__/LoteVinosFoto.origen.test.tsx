/**
 * «Varias botellas»: si la IA no saca claro el origen de una botella, la lista
 * lo dice antes de abrirla (el formulario lo pedirá y no guardará sin él).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LoteVinosDialog } from "../LoteVinosFoto";
import type { FilaLote, LoteVinos } from "../useLoteVinos";
import type { DatosVinoFoto } from "../leerVinoFoto";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const datos = (p: Partial<DatosVinoFoto>): DatosVinoFoto => ({
  nombre: "Vino", categoria: "VINOS TINTOS — RIOJA", descripcion: null, ingredientes: null, denominacion_origen: null,
  ubicacion_region: "Haro, La Rioja", ubicacion_pais: "España", ...p,
});
const fila = (id: string, d: DatosVinoFoto): FilaLote => ({
  id, archivo: new File(["x"], `${id}.jpg`, { type: "image/jpeg" }), miniatura: "blob:x", estado: "listo", recorte: "listo",
  resultado: { datos: d, foto: new File(["x"], "b.jpg", { type: "image/jpeg" }) },
});

describe("Lote de botellas y origen", () => {
  it("marca las botellas sin origen claro", () => {
    const lote = {
      filas: [
        fila("a", datos({ nombre: "Con origen" })),
        fila("b", datos({ nombre: "Sin país", ubicacion_pais: null })),
        fila("c", datos({ nombre: "Pendiente", categoria: "VINOS ESPUMOSOS — ORIGEN PENDIENTE" })),
      ],
      añadir: vi.fn(), quitar: vi.fn(), vaciar: vi.fn(), reintentar: vi.fn(), marcarGuardado: vi.fn(),
    } as unknown as LoteVinos;
    render(<LoteVinosDialog open onOpenChange={vi.fn()} lote={lote} onAbrirFila={vi.fn()} />);
    const boton = (nombre: string) => screen.getByRole("button", { name: `Revisar ${nombre}` });
    expect(within(boton("Con origen")).queryByText(/Origen por confirmar/)).not.toBeInTheDocument();
    expect(within(boton("Sin país")).getByText("Origen por confirmar: complétalo al revisar")).toBeInTheDocument();
    expect(within(boton("Pendiente")).getByText("Origen por confirmar: complétalo al revisar")).toBeInTheDocument();
  });
});
