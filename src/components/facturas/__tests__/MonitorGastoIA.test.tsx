import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FilaGastoIa } from "@/lib/facturas/gastoIa";

let datos: FilaGastoIa[] | undefined = [];
let cargando = false;
vi.mock("@/hooks/useGastoIa", () => ({
  useGastoIa: () => ({ data: datos, isLoading: cargando }),
}));

import { MonitorGastoIA } from "../MonitorGastoIA";

const fila = (over: Partial<FilaGastoIa>): FilaGastoIa => ({
  funcion: "chat-facturas", coste_usd: 0, filas: 1, llamadas: 1, unidades: 1,
  filas_sin_tarifa: 0, documentos_ocr: 0, ultima: null, ...over,
});

describe("MonitorGastoIA", () => {
  beforeEach(() => {
    datos = [];
    cargando = false;
  });

  it("pestaña IA: una línea con total, preguntas y coste por pregunta", () => {
    datos = [fila({ funcion: "chat-facturas", coste_usd: 0.2264, unidades: 187 })];
    render(<MonitorGastoIA modo="chat" />);
    const boton = screen.getByTestId("monitor-gasto-ia-chat");
    expect(boton).toHaveTextContent("IA este mes: 0,21 € · 187 preguntas · 0,001 € por pregunta");
    expect(boton.className).toContain("min-h-11");
  });

  it("pestaña Cargar sin datos del OCR: «sin datos todavía»", () => {
    datos = [fila({ funcion: "chat-facturas", coste_usd: 0.2264, unidades: 187 })];
    render(<MonitorGastoIA modo="ocr" />);
    expect(screen.getByTestId("monitor-gasto-ia-ocr")).toHaveTextContent("Lectura de facturas este mes: sin datos todavía");
  });

  it("Cargar con datos y desglose por proceso al abrir", () => {
    datos = [
      fila({ funcion: "ocr-trabajo", coste_usd: 1, unidades: 4, documentos_ocr: 4 }),
      fila({ funcion: "clasificar-productos", coste_usd: 0.0869565, unidades: 2 }),
    ];
    render(<MonitorGastoIA modo="ocr" />);
    const boton = screen.getByTestId("monitor-gasto-ia-ocr");
    expect(boton).toHaveTextContent("1,00 € · 4 documentos · 0,25 € por documento");
    fireEvent.click(boton);
    expect(screen.getByText("Lectura de facturas (OCR)")).toBeInTheDocument();
    expect(screen.getByText("Clasificación de productos")).toBeInTheDocument();
    expect(screen.getByText("Chatbot de facturas")).toBeInTheDocument();
    expect(screen.getByText(/1 USD ≈ 0,92 EUR/)).toBeInTheDocument();
  });

  it("mientras carga no inventa cifras", () => {
    cargando = true;
    datos = undefined;
    render(<MonitorGastoIA modo="chat" />);
    expect(screen.getByTestId("monitor-gasto-ia-chat")).toHaveTextContent("cargando…");
  });
});
