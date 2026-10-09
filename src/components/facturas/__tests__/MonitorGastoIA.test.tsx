import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FilaGastoIa, GastoReal } from "@/lib/facturas/gastoIa";

let datos: FilaGastoIa[] | undefined = [];
let cargando = false;
let datosReal: GastoReal | null = null;
vi.mock("@/hooks/useGastoIa", () => ({
  useGastoIa: () => ({ data: datos, isLoading: cargando }),
  useGastoIaReal: () => ({ data: datosReal, isLoading: false }),
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
    datosReal = null;
  });

  it("pestaña IA: una línea con total, preguntas y coste por pregunta", () => {
    datos = [fila({ funcion: "chat-facturas", coste_usd: 0.2264, unidades: 187 })];
    render(<MonitorGastoIA modo="chat" />);
    const boton = screen.getByTestId("monitor-gasto-ia-chat");
    expect(boton).toHaveTextContent("IA este mes: 0,21 € · 187 preguntas · 0,001 € por pregunta · estimado");
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

  describe("con la RPC de gasto real", () => {
    const real = (over: Partial<GastoReal> = {}): GastoReal => ({
      filas: [
        { proceso: "ocr", usd_real: 1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0.1 },
        { proceso: "chat", usd_real: 0.5, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0.05 },
        { proceso: "otros", usd_real: 0.2, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
      ],
      tipo: { eurPorUsd: 0.5, fecha: "2026-10-07", fuente: "bce" },
      ...over,
    });

    it("existe con datos: real hasta la fecha + hoy estimado, con el tipo del BCE y sin IVA", () => {
      datosReal = real();
      datos = [fila({ funcion: "ocr-trabajo", coste_usd: 99, unidades: 4, documentos_ocr: 4 })];
      render(<MonitorGastoIA modo="ocr" />);
      const boton = screen.getByTestId("monitor-gasto-ia-ocr");
      // (1 + 0,1) USD x 0,5 = 0,55 €; hoy 0,1 x 0,5 = 0,05 €
      expect(boton).toHaveTextContent("Lectura de facturas este mes: 0,55 € · real hasta 7 oct + hoy est. 0,050 € · sin IVA");
      fireEvent.click(boton);
      expect(screen.getByText("Chatbot")).toBeInTheDocument();
      expect(screen.getByText("Otros (traducciones, novedades…)")).toBeInTheDocument();
      expect(screen.getAllByText(/Real \(OpenAI\) hasta 7 oct: 0,50 €/).length).toBeGreaterThan(0); // ocr
      expect(screen.getByText(/1 USD = 0,500 EUR, BCE 7 oct/)).toBeInTheDocument();
      // total: (1,7 + 0,15) x 0,5 = 0,925 €
      expect(screen.getByText(/^0,9[23] €$/)).toBeInTheDocument();
    });

    it("con la RPC por clave: Chat de la web, Vinos desde foto, sub-líneas de Otros, «repartido por clave» y «sin IVA»", () => {
      datosReal = real({
        filas: [
          { proceso: "ocr", usd_real: 1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "chat", usd_real: 0.5, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "chatweb", usd_real: 0.4, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "vinos", usd_real: 0.2, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "otros", usd_real: 0.1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
        ],
        subs: [
          { proceso: "traducciones", usd_real: 0.06, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "novedades", usd_real: 0.04, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
        ],
        reparto: "clave_tarifa",
      });
      render(<MonitorGastoIA modo="chat" />);
      fireEvent.click(screen.getByTestId("monitor-gasto-ia-chat"));
      expect(screen.getByText("Chat de la web")).toBeInTheDocument();
      expect(screen.getByText("Vinos desde foto")).toBeInTheDocument();
      expect(screen.getByText("Traducciones (estimado)")).toBeInTheDocument();
      expect(screen.getByText("Novedades (formato) (estimado)")).toBeInTheDocument();
      expect(screen.getByText(/Real repartido por clave \(tokens × tarifa\)\. Sin IVA\./)).toBeInTheDocument();
      // total: (1 + 0,5 + 0,4 + 0,2 + 0,1) x 0,5 = 1,10 €
      expect(screen.getByText(/^1,10 €$/)).toBeInTheDocument();
    });

    it("chat usa el proceso chat", () => {
      datosReal = real();
      render(<MonitorGastoIA modo="chat" />);
      expect(screen.getByTestId("monitor-gasto-ia-chat")).toHaveTextContent("0,28 € · real hasta 7 oct + hoy est. 0,025 €");
    });

    it("sin datos reales todavía (null): sigue el estimado, marcado «estimado»", () => {
      datosReal = null;
      datos = [fila({ funcion: "chat-facturas", coste_usd: 0.2264, unidades: 187 })];
      render(<MonitorGastoIA modo="chat" />);
      const boton = screen.getByTestId("monitor-gasto-ia-chat");
      expect(boton).toHaveTextContent("estimado");
      expect(boton).not.toHaveTextContent("real hasta");
      fireEvent.click(boton);
      expect(screen.getByText(/aún sin el gasto real de OpenAI/)).toBeInTheDocument();
    });
  });
});
