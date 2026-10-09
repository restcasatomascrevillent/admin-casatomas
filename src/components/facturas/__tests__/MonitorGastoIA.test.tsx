import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FilaGastoIa, GastoReal } from "@/lib/facturas/gastoIa";

let datos: FilaGastoIa[] | undefined = [];
let cargando = false;
let datosReal: GastoReal | null = null;
let tope: number | undefined = 5;
vi.mock("@/hooks/useGastoIa", () => ({
  useGastoIa: () => ({ data: datos, isLoading: cargando }),
  useGastoIaRealMes: () => ({ data: datosReal ? { actual: datosReal, anterior: null } : null, isLoading: false }),
  useTopeIaMes: () => ({ data: tope }),
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
    tope = 5;
  });

  it("pestaña IA: una línea con total, preguntas y coste por pregunta", () => {
    datos = [fila({ funcion: "chat-facturas", coste_usd: 0.2264, unidades: 187 })];
    render(<MonitorGastoIA modo="chat" />);
    const boton = screen.getByTestId("monitor-gasto-ia-chat");
    expect(boton).toHaveTextContent("IA este mes: 0,21 € · 187 preguntas · 0,001 € por pregunta · estimado");
    expect(boton.className).toContain("min-h-11");
    expect(boton).toHaveAttribute("data-nivel-tope", "ok");
  });

  it("pestaña Cargar sin datos del OCR: «sin datos todavía»", () => {
    datos = [fila({ funcion: "chat-facturas", coste_usd: 0.2264, unidades: 187 })];
    render(<MonitorGastoIA modo="ocr" />);
    expect(screen.getByTestId("monitor-gasto-ia-ocr")).toHaveTextContent("Lectura de facturas este mes: sin datos todavía");
  });

  it("Cargar con datos: desglose SOLO del OCR (lectura + clasificación), sin el chatbot", () => {
    datos = [
      fila({ funcion: "ocr-trabajo", coste_usd: 1, unidades: 4, documentos_ocr: 4 }),
      fila({ funcion: "clasificar-productos", coste_usd: 0.0869565, unidades: 2 }),
      fila({ funcion: "chat-facturas", coste_usd: 0.5, unidades: 10 }),
    ];
    render(<MonitorGastoIA modo="ocr" />);
    const boton = screen.getByTestId("monitor-gasto-ia-ocr");
    expect(boton).toHaveTextContent("1,00 € · 4 documentos · 0,25 € por documento");
    fireEvent.click(boton);
    expect(screen.getByText("Lectura de facturas (OCR)")).toBeInTheDocument();
    expect(screen.getByText("Clasificación de productos")).toBeInTheDocument();
    expect(screen.queryByText("Chatbot de facturas")).not.toBeInTheDocument();
    expect(screen.getByText(/1 USD ≈ 0,92 EUR/)).toBeInTheDocument();
  });

  it("mientras carga no inventa cifras", () => {
    cargando = true;
    datos = undefined;
    render(<MonitorGastoIA modo="chat" />);
    expect(screen.getByTestId("monitor-gasto-ia-chat")).toHaveTextContent("cargando…");
  });

  describe("con la RPC de gasto real (mes en curso)", () => {
    const real = (over: Partial<GastoReal> = {}): GastoReal => ({
      filas: [
        { proceso: "ocr", usd_real: 1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0.1 },
        { proceso: "chat", usd_real: 0.5, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0.05 },
        { proceso: "otros", usd_real: 0.2, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
      ],
      tipo: { eurPorUsd: 0.5, fecha: "2026-10-07", fuente: "bce" },
      ...over,
    });

    it("Cargar: solo el OCR, real hasta la fecha + hoy estimado, con el tipo del BCE y sin IVA", () => {
      datosReal = real();
      render(<MonitorGastoIA modo="ocr" />);
      const boton = screen.getByTestId("monitor-gasto-ia-ocr");
      // (1 + 0,1) USD x 0,5 = 0,55 €; hoy 0,1 x 0,5 = 0,05 €
      expect(boton).toHaveTextContent("Lectura de facturas este mes: 0,55 € · real hasta 7 oct + hoy est. 0,050 € · sin IVA");
      fireEvent.click(boton);
      expect(screen.getByText("Lectura de facturas")).toBeInTheDocument();
      expect(screen.getByText(/Real \(OpenAI\) hasta 7 oct: 0,50 €/)).toBeInTheDocument();
      expect(screen.getByText(/1 USD = 0,500 EUR, BCE 7 oct/)).toBeInTheDocument();
      // Nada de los demás procesos: ni chatbot, ni «Otros», ni el total del restaurante.
      expect(screen.queryByText("Chatbot")).not.toBeInTheDocument();
      expect(screen.queryByText(/Otros/)).not.toBeInTheDocument();
      expect(screen.queryByText("Total")).not.toBeInTheDocument();
    });

    it("quita Chat de la web, Vinos y las sub-líneas de Otros del desglose de Facturas", () => {
      datosReal = real({
        filas: [
          { proceso: "ocr", usd_real: 1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "chat", usd_real: 0.5, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "chatweb", usd_real: 0.4, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "vinos", usd_real: 0.2, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
          { proceso: "otros", usd_real: 0.1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
        ],
        subs: [{ proceso: "traducciones", usd_real: 0.06, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 }],
        reparto: "clave_tarifa",
      });
      render(<MonitorGastoIA modo="chat" />);
      fireEvent.click(screen.getByTestId("monitor-gasto-ia-chat"));
      expect(screen.getByText("Chatbot")).toBeInTheDocument();
      expect(screen.queryByText("Chat de la web")).not.toBeInTheDocument();
      expect(screen.queryByText("Vinos desde foto")).not.toBeInTheDocument();
      expect(screen.queryByText(/Traducciones/)).not.toBeInTheDocument();
      expect(screen.getByText(/Real repartido por clave \(tokens × tarifa\)\. Sin IVA\./)).toBeInTheDocument();
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

  describe("aviso del tope mensual de IA", () => {
    // Total del restaurante con k = 0,5: (1,1 + 0,55 + 0,2) x 0,5 = 0,925 €
    const real: GastoReal = {
      filas: [
        { proceso: "ocr", usd_real: 1, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0.1 },
        { proceso: "chat", usd_real: 0.5, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0.05 },
        { proceso: "otros", usd_real: 0.2, ultimo_dia_real: "2026-10-07", usd_estimado_hoy: 0 },
      ],
      tipo: { eurPorUsd: 0.5, fecha: "2026-10-07", fuente: "bce" },
    };

    it("por debajo del 80 %: sin aviso", () => {
      datosReal = real;
      tope = 5;
      render(<MonitorGastoIA modo="ocr" />);
      expect(screen.getByTestId("monitor-gasto-ia-ocr")).toHaveAttribute("data-nivel-tope", "ok");
      fireEvent.click(screen.getByTestId("monitor-gasto-ia-ocr"));
      expect(screen.queryByTestId("aviso-tope-ia")).not.toBeInTheDocument();
    });

    it("entre el 80 y el 100 %: ámbar, sin euros de otros procesos", () => {
      datosReal = real;
      tope = 1; // 0,925 / 1 = 92,5 %
      render(<MonitorGastoIA modo="ocr" />);
      const boton = screen.getByTestId("monitor-gasto-ia-ocr");
      expect(boton).toHaveAttribute("data-nivel-tope", "aviso");
      expect(boton.className).toContain("amber");
      fireEvent.click(boton);
      const aviso = screen.getByTestId("aviso-tope-ia");
      expect(aviso).toHaveAttribute("data-nivel", "aviso");
      expect(aviso).toHaveTextContent(/lleva el 93 % del tope \(1,00 €\)/);
      expect(aviso).not.toHaveTextContent("0,925");
    });

    it("al superar el tope: rojo", () => {
      datosReal = real;
      tope = 0.5;
      render(<MonitorGastoIA modo="ocr" />);
      const boton = screen.getByTestId("monitor-gasto-ia-ocr");
      expect(boton).toHaveAttribute("data-nivel-tope", "superado");
      expect(boton.className).toContain("destructive");
      fireEvent.click(boton);
      expect(screen.getByTestId("aviso-tope-ia")).toHaveTextContent(/ha superado el tope \(0,50 €\)/);
    });

    it("sin gasto real, el tope se mide con el estimado de Facturas", () => {
      datos = [fila({ funcion: "chat-facturas", coste_usd: 6, unidades: 10 })]; // 5,52 €
      tope = 5;
      render(<MonitorGastoIA modo="chat" />);
      expect(screen.getByTestId("monitor-gasto-ia-chat")).toHaveAttribute("data-nivel-tope", "superado");
    });
  });
});
