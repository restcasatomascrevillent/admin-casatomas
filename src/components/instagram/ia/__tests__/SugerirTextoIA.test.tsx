/**
 * «Sugerir texto» con IA: tono e indicaciones llegan a la función, 3
 * propuestas para elegir (con hashtags que se pueden quitar), estados de
 * carga y error, rótulos opcionales, y elegir SOLO rellena (onElegir) y anota
 * la elección; nunca publica. Sin red: fetch simulado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const sb = vi.hoisted(() => ({
  updates: [] as Array<{ tabla: string; valores: Record<string, unknown>; id: string }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt-de-prueba" } } }) },
    from: (tabla: string) => ({
      update: (valores: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => {
          sb.updates.push({ tabla, valores, id });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  },
}));

import { SugerirTextoIA } from "../SugerirTextoIA";
import { URL_IA, type ContextoPiezaIA } from "../api";

const CONTEXTO: ContextoPiezaIA = {
  marca: "casa-tomas",
  formato: "post",
  plantilla: "ct-foto-titular",
  foto: "carta:pulpo-feira",
  piezaId: "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f",
  textos: { titular: "El pulpo de casa" },
};

const RESPUESTA = {
  ok: true,
  accion: "sugerir_texto",
  sugerenciaId: "99999999-9999-4999-8999-999999999999",
  modelo: "gpt-5.6-luna",
  plato: { id: "pulpo-feira", nombre: "Pulpo a la gallega" },
  variantes: [1, 2, 3].map((n) => ({
    gancho: `Gancho ${n}`,
    caption: `Texto ${n}. Pulpo a la gallega.`,
    hashtags: ["#CasaTomás", "#Crevillent", `#Extra${n}`],
    altText: `Descripción ${n}`,
    platosCitados: ["Pulpo a la gallega"],
    avisos: n === 3 ? ["Se han quitado los emoji (la marca no los usa)."] : [],
  })),
  descartadas: [{ motivos: ["Precio que no viene de la carta (15 €)"] }],
  avisos: [],
};

function fetchFalso(respuestas: Array<[number, unknown]>) {
  const cola = [...respuestas];
  return vi.fn(async (_url: string, _init: RequestInit) => {
    const [estado, cuerpo] = cola.shift() ?? [500, { error: "sin respuesta" }];
    return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
  });
}

beforeEach(() => {
  sb.updates = [];
});

describe("SugerirTextoIA", () => {
  it("pide 3 textos con tono, indicaciones y precio, y elegir solo rellena", async () => {
    const f = fetchFalso([[200, RESPUESTA]]);
    const onElegir = vi.fn();
    render(<SugerirTextoIA contexto={CONTEXTO} onElegir={onElegir} opcionesLlamada={{ fetch: f as unknown as typeof fetch }} />);

    fireEvent.click(screen.getByRole("radio", { name: "Con retranca" }));
    fireEvent.change(screen.getByLabelText("Indicaciones (opcional)"), { target: { value: "Que se note el otoño" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /precio de la carta/ }));
    fireEvent.click(screen.getByRole("button", { name: "Proponer 3 textos" }));

    expect(screen.getByRole("button", { name: /Pensando/ })).toBeDisabled();
    expect(screen.getByText(/Preparando propuestas/)).toBeInTheDocument();
    const lista = await screen.findByRole("list", { name: "Propuestas de texto" });
    expect(within(lista).getAllByRole("button", { name: "Usar este texto" })).toHaveLength(3);
    expect(within(lista).getByText("Texto 1. Pulpo a la gallega.")).toBeInTheDocument();

    const [url, init] = f.mock.calls[0];
    expect(url).toBe(URL_IA);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-de-prueba");
    expect(JSON.parse(init.body as string)).toMatchObject({
      accion: "sugerir_texto",
      marca: "casa-tomas",
      plantilla: "ct-foto-titular",
      foto: "carta:pulpo-feira",
      tono: "retranca",
      indicaciones: "Que se note el otoño",
      incluirPrecio: true,
      textos: { titular: "El pulpo de casa" },
    });

    // Avisos de corrección y descartadas a la vista.
    expect(screen.getByText("Se han quitado los emoji (la marca no los usa).")).toBeInTheDocument();
    expect(screen.getByText(/1 propuesta descartada/)).toBeInTheDocument();

    // Se quita un hashtag de la propuesta 2 y se elige.
    fireEvent.click(screen.getByRole("button", { name: "Quitar #Extra2" }));
    const botones = screen.getAllByRole("button", { name: "Usar este texto" });
    fireEvent.click(botones[1]);
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir).toHaveBeenCalledWith("Texto 2. Pulpo a la gallega.", ["#CasaTomás", "#Crevillent"], "Descripción 2");
    expect(screen.getByRole("button", { name: "Elegida" })).toBeInTheDocument();
    await waitFor(() =>
      expect(sb.updates).toEqual([
        { tabla: "instagram_sugerencias_ia", valores: { aceptada: true, variante_elegida: 1 }, id: RESPUESTA.sugerenciaId },
      ]),
    );
    // Solo una llamada a la función: elegir no publica ni vuelve a llamar.
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("sin foto de la carta no ofrece el precio", () => {
    render(<SugerirTextoIA contexto={{ ...CONTEXTO, foto: "drive:abc" }} onElegir={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: /precio/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Proponer rótulos" })).not.toBeInTheDocument();
  });

  it("error 422: muestra el motivo, las descartadas y deja reintentar", async () => {
    const f = fetchFalso([
      [422, { ok: false, error: "Ninguna propuesta ha pasado las comprobaciones", descartadas: [{ motivos: ["Dice «sin gluten»…"] }] }],
      [200, RESPUESTA],
    ]);
    render(<SugerirTextoIA contexto={CONTEXTO} onElegir={vi.fn()} opcionesLlamada={{ fetch: f as unknown as typeof fetch }} />);
    fireEvent.click(screen.getByRole("button", { name: "Proponer 3 textos" }));
    expect(await screen.findByText("Ninguna propuesta ha pasado las comprobaciones")).toBeInTheDocument();
    expect(screen.getByText("Dice «sin gluten»…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("list", { name: "Propuestas de texto" })).toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("cupo agotado: sin botón de reintentar", async () => {
    const f = fetchFalso([[429, { ok: false, error: "Has llegado al tope de 100 sugerencias de IA por día." }]]);
    render(<SugerirTextoIA contexto={CONTEXTO} onElegir={vi.fn()} opcionesLlamada={{ fetch: f as unknown as typeof fetch }} />);
    fireEvent.click(screen.getByRole("button", { name: "Proponer 3 textos" }));
    expect(await screen.findByText(/tope de 100/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("función sin desplegar: lo dice claro", async () => {
    const f = fetchFalso([[404, { message: "Requested function was not found" }]]);
    render(<SugerirTextoIA contexto={CONTEXTO} onElegir={vi.fn()} opcionesLlamada={{ fetch: f as unknown as typeof fetch }} />);
    fireEvent.click(screen.getByRole("button", { name: "Proponer 3 textos" }));
    expect(await screen.findByText(/no está desplegada/)).toBeInTheDocument();
  });

  it("rótulos: se piden aparte y se eligen con onElegirRotulos", async () => {
    const f = fetchFalso([
      [200, { ok: true, accion: "sugerir_rotulos", sugerenciaId: null, modelo: "gpt-5.6-luna", plato: null, descartadas: [], avisos: [],
        variantes: [{ antetitulo: "Del mar", titular: "El pulpo de casa", cta: "Ver carta", avisos: [] }] }],
    ]);
    const onElegir = vi.fn();
    const onElegirRotulos = vi.fn();
    render(<SugerirTextoIA contexto={CONTEXTO} onElegir={onElegir} onElegirRotulos={onElegirRotulos} opcionesLlamada={{ fetch: f as unknown as typeof fetch }} />);
    fireEvent.click(screen.getByRole("button", { name: "Proponer rótulos" }));
    const lista = await screen.findByRole("list", { name: "Propuestas de rótulos" });
    expect(within(lista).getByText("El pulpo de casa")).toBeInTheDocument();
    expect(JSON.parse(f.mock.calls[0][1].body as string).accion).toBe("sugerir_rotulos");
    fireEvent.click(screen.getByRole("button", { name: "Usar estos rótulos" }));
    expect(onElegirRotulos).toHaveBeenCalledWith({ antetitulo: "Del mar", titular: "El pulpo de casa", cta: "Ver carta" });
    expect(onElegir).not.toHaveBeenCalled();
    expect(sb.updates).toEqual([]); // sin sugerenciaId no se anota nada
  });

  it("deshabilitado: no deja pedir", () => {
    render(<SugerirTextoIA contexto={CONTEXTO} onElegir={vi.fn()} deshabilitado />);
    expect(screen.getByRole("button", { name: "Proponer 3 textos" })).toBeDisabled();
  });
});
