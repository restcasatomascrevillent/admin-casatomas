/**
 * Pestaña «Encargos» con Supabase, permisos y avisos simulados (sin red):
 * tablero por columnas y contador, ficha con «Aprobar» y «Pedir cambios»
 * (rondas), la agencia acepta y no ve «Pedir», el formulario guarda y envía
 * por RPC, cada cambio pide el push (notificar-video, tipo «encargo»), la
 * campana lleva a la ficha y el calendario pinta los huecos de encargo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const sb = vi.hoisted(() => ({
  datos: {} as Record<string, unknown[]>,
  rpc: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>,
  invoke: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>,
  upload: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>,
  roles: { marketing: true, instagram_agencia: false } as Record<string, boolean>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const filtros: Array<[string, unknown]> = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "gte", "lt", "lte", "order", "limit", "not", "update"]) q[m] = () => q;
    q.eq = (c: string, v: unknown) => {
      filtros.push([c, v]);
      return q;
    };
    const filas = () => (sb.datos[tabla] ?? []).filter((f) => filtros.every(([c, v]) => (f as Record<string, unknown>)[c] === v));
    q.maybeSingle = () => Promise.resolve({ data: filas()[0] ?? null, error: null });
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve({ data: filas(), error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } } }) },
      from: consulta,
      rpc: (...a: unknown[]) => sb.rpc(...a),
      functions: { invoke: (...a: unknown[]) => sb.invoke(...a) },
      storage: { from: () => ({ upload: (...a: unknown[]) => sb.upload(...a) }) },
    },
  };
});
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (k: string) => ({ canAccess: !!sb.roles[k], loading: false }),
}));
vi.mock("@/components/carta/potente/pushVideo", () => ({
  pushDisponible: () => ({ ok: false, motivo: "sin claves" }),
  activarAvisosPush: vi.fn(),
}));
vi.mock("@/components/marketing/instagram/SelectorFoto", () => ({
  SelectorFoto: ({ onCambio }: { onCambio: (id: string) => void }) => (
    <button type="button" onClick={() => onCambio("drive:cesta")}>
      Elegir foto de prueba
    </button>
  ),
}));
vi.mock("@/components/marketing/instagram/useFotosInstagram", async (orig) => ({
  ...(await orig<object>()),
  useFotosInstagram: () => ({ fotos: [{ id: "drive:cesta", descripcion: "Cesta de setas" }], catalogo: [] }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { EncargosInstagram } from "../index";
import { CalendarioInstagram } from "@/components/instagram/programar";
import { rutaDeAviso } from "@/lib/avisos";
import { toast } from "sonner";

const AHORA = new Date("2026-11-05T10:00:00Z");
const ID_REV = "3f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";
const ID_ENV = "4f2b8a52-6c1e-4d7a-9b0f-1a2b3c4d5e6f";

const encargo = (extra: Record<string, unknown>) => ({
  id: "x",
  numero: 1,
  marca: "casa-tomas",
  modo: "oficiosos",
  formato: "reel",
  titulo: "Encargo",
  idea: "Idea",
  estilo: null,
  plantilla: null,
  base_reel: null,
  texto: null,
  fecha_deseada: "2026-11-12",
  fecha_entrega_prevista: "2026-11-12",
  fecha_entrega: null,
  estado: "enviado",
  rondas_cambios: 0,
  rondas_incluidas: 2,
  motivo: null,
  pieza_id: null,
  creado_por: "u1",
  asignado_a: null,
  enviado_at: "2026-11-04T10:00:00Z",
  entregado_at: null,
  aprobado_at: null,
  created_at: "2026-11-04T10:00:00Z",
  updated_at: "2026-11-04T10:00:00Z",
  ...extra,
});

function datosBase() {
  sb.datos = {
    instagram_encargos: [
      encargo({ id: ID_REV, numero: 7, titulo: "Reel del mar", estado: "para_revisar", rondas_cambios: 2 }),
      encargo({ id: ID_ENV, numero: 8, titulo: "Navidad", estado: "enviado", marca: "touza", formato: "post" }),
      encargo({ id: "c", numero: 9, titulo: "Publicado ya", estado: "publicado" }),
      encargo({ id: "d", numero: 10, titulo: "Cancelado", estado: "cancelado" }),
    ],
    instagram_encargos_ajustes: [{ plazo_dias_laborables: 5, rondas_incluidas: 2, cupo_mensual: null }],
    instagram_encargo_entregas: [
      { id: "v1", encargo_id: ID_REV, version: 1, tipo_medio: "reel", cubo: "instagram-video", ruta: `reels/2026-11/${ID_REV}-abcdef01.mp4`, portada_ruta: null, pieza_id: null, bytes: 1, ancho: 1080, alto: 1920, duracion_s: 18, texto: "Del mar", nota: "Primera", created_at: "2026-11-04T11:00:00Z" },
      { id: "v2", encargo_id: ID_REV, version: 2, tipo_medio: "reel", cubo: "instagram-video", ruta: `reels/2026-11/${ID_REV}-abcdef02.mp4`, portada_ruta: null, pieza_id: null, bytes: 1, ancho: 1080, alto: 1920, duracion_s: 18, texto: "Del mar", nota: "Más luz", created_at: "2026-11-05T09:00:00Z" },
    ],
    instagram_encargo_mensajes: [{ id: "m1", encargo_id: ID_REV, autor: "u2", lado: "agencia", texto: "Te subo la versión 2", created_at: "2026-11-05T09:00:00Z" }],
    instagram_encargo_eventos: [{ id: "e1", encargo_id: ID_REV, actor: "u2", lado: "agencia", accion: "entregar", de_estado: "en_curso", a_estado: "para_revisar", comentario: "Versión 2", created_at: "2026-11-05T09:00:00Z" }],
    instagram_encargo_adjuntos: [],
  };
}

function montar(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  datosBase();
  sb.roles = { marketing: true, instagram_agencia: false };
  sb.rpc = vi.fn(async (nombre: unknown) => ({ data: { ok: true, eventoId: "ev-1", encargo: { ...encargo({ id: "nuevo" }), estado: nombre === "instagram_encargo_guardar" ? "borrador" : "enviado" } }, error: null }));
  sb.invoke = vi.fn(async () => ({ data: { ok: true, enviadas: 1 }, error: null }));
  sb.upload = vi.fn(async () => ({ data: {}, error: null }));
  vi.mocked(toast.success).mockClear();
});

describe("Encargos · restaurante", () => {
  it("tablero por columnas, resumen y botón «Pedir»", async () => {
    montar(<EncargosInstagram />);
    const tablero = await screen.findByTestId("tablero-encargos");
    expect(within(within(tablero).getByRole("region", { name: "Para revisar" })).getByText("Reel del mar")).toBeTruthy();
    expect(within(within(tablero).getByRole("region", { name: "Pedido" })).getByText("Navidad")).toBeTruthy();
    expect(within(within(tablero).getByRole("region", { name: "Publicado" })).getByText("Publicado ya")).toBeTruthy();
    expect(within(tablero).queryByText("Cancelado")).toBeNull();
    expect(screen.getByTestId("resumen-encargos").textContent).toMatch(/1 espera tu revisión/);
    expect(screen.getByRole("button", { name: /Pedir un vídeo o una pieza/ })).toBeTruthy();
    // Filtro por marca y cancelados a petición.
    fireEvent.click(screen.getByRole("button", { name: "Touza" }));
    expect(within(tablero).queryByText("Reel del mar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cancelados \(1\)/ }));
    expect(await screen.findByRole("region", { name: "Cancelados" })).toBeTruthy();
  });

  it("la ficha enseña la versión 2 y al aprobar llama a la RPC y avisa por push", async () => {
    montar(<EncargosInstagram />);
    fireEvent.click(await screen.findByText("Reel del mar"));
    const ficha = await screen.findByTestId("ficha-encargo");
    expect(await within(ficha).findByRole("heading", { name: /Versión 2 ·/ })).toBeTruthy();
    expect(within(ficha).getByText(/Versiones anteriores \(1\)/)).toBeTruthy();
    expect(within(ficha).getByText("Te subo la versión 2")).toBeTruthy();
    // Ya van 2 rondas de 2: la siguiente sería extra.
    expect(within(ficha).getByTestId("contador-rondas").textContent).toMatch(/Ronda 3 · fuera de las 2 incluidas/);
    expect(within(ficha).queryByRole("button", { name: "Aceptar" })).toBeNull();
    fireEvent.click(within(ficha).getByRole("button", { name: /Aprobar/ }));
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith("instagram_encargo_aprobar", { p_id: ID_REV }));
    await waitFor(() => expect(sb.invoke).toHaveBeenCalledWith("notificar-video", { body: { evento_id: "ev-1", tipo: "encargo" } }));
  });

  it("pedir cambios exige comentario y avisa de la ronda extra", async () => {
    montar(<EncargosInstagram />);
    fireEvent.click(await screen.findByText("Reel del mar"));
    const ficha = await screen.findByTestId("ficha-encargo");
    fireEvent.click(await within(ficha).findByRole("button", { name: "Pedir cambios" }));
    const boton = within(ficha).getAllByRole("button", { name: "Pedir cambios" }).at(-1)!;
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(ficha).getByLabelText("¿Qué cambiarías?"), { target: { value: "El bogavante, 4 s" } });
    fireEvent.click(boton);
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith("instagram_encargo_pedir_cambios", { p_id: ID_REV, p_comentario: "El bogavante, 4 s" }));
  });

  it("el formulario enseña las condiciones, guarda y envía por RPC", async () => {
    montar(<EncargosInstagram />);
    fireEvent.click(await screen.findByRole("button", { name: /Pedir un vídeo o una pieza/ }));
    const form = await screen.findByTestId("formulario-encargo");
    expect(within(form).getByTestId("condiciones-encargo").textContent).toMatch(/5 días laborables .*12 nov.*2 rondas de cambios incluidas y sin límite/);
    fireEvent.click(within(form).getByRole("button", { name: /Enviar encargo/ }));
    expect((await within(form).findByTestId("errores-encargo")).textContent).toMatch(/título/);
    expect(sb.rpc).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText("Título"), { target: { value: "Setas" } });
    fireEvent.change(within(form).getByLabelText("Para cuándo"), { target: { value: "2026-11-20" } });
    fireEvent.change(within(form).getByLabelText("La idea"), { target: { value: "De la cesta al plato" } });
    fireEvent.click(within(form).getByRole("button", { name: "Elegir foto de prueba" }));
    expect(within(form).getByText("Cesta de setas")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: /Enviar encargo/ }));
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith("instagram_encargo_enviar", { p_id: "nuevo" }));
    const guardar = sb.rpc.mock.calls.find((c) => c[0] === "instagram_encargo_guardar")![1] as { p_id: null; p_datos: Record<string, unknown> };
    expect(guardar.p_id).toBeNull();
    expect(guardar.p_datos).toMatchObject({ marca: "casa-tomas", modo: "oficiosos", formato: "reel", titulo: "Setas", fecha_deseada: "2026-11-20", fotos: [{ id: "drive:cesta", nombre: "Cesta de setas" }] });
    // Guardar no avisa a nadie; enviar sí.
    await waitFor(() => expect(sb.invoke).toHaveBeenCalledTimes(1));
  });
});

describe("Encargos · agencia", () => {
  it("sin «Pedir»; acepta con fecha de entrega y entrega una versión subida al cubo", async () => {
    sb.roles = { marketing: false, instagram_agencia: true };
    montar(<EncargosInstagram />);
    expect(screen.queryByRole("button", { name: /Pedir un vídeo/ })).toBeNull();
    await waitFor(() => expect(screen.getByTestId("resumen-encargos").textContent).toMatch(/4 encargos este mes · 1 espera a Oficiosos/));
    fireEvent.click(await screen.findByText("Navidad"));
    const ficha = await screen.findByTestId("ficha-encargo");
    expect(within(ficha).queryByRole("button", { name: /Aprobar/ })).toBeNull();
    expect(within(ficha).queryByRole("button", { name: /Cancelar encargo/ })).toBeNull();
    fireEvent.click(within(ficha).getByRole("button", { name: "Aceptar" }));
    const fecha = within(ficha).getByLabelText("Fecha de entrega comprometida") as HTMLInputElement;
    expect(fecha.value).toBe("2026-11-10"); // dos días antes de la fecha deseada
    fireEvent.click(within(ficha).getAllByRole("button", { name: "Aceptar" })[0]); // el del panel (el del pie va después)
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith("instagram_encargo_aceptar", { p_id: ID_ENV, p_fecha_entrega: "2026-11-10", p_comentario: null }));
  });

  it("entregar sube el JPEG a encargos/<encargo>/v1-… y llama a la RPC", async () => {
    sb.roles = { marketing: false, instagram_agencia: true };
    sb.datos.instagram_encargos = [encargo({ id: ID_ENV, titulo: "Navidad", estado: "en_curso", formato: "post" })];
    montar(<EncargosInstagram />);
    fireEvent.click(await screen.findByText("Navidad"));
    const ficha = await screen.findByTestId("ficha-encargo");
    fireEvent.click(within(ficha).getByRole("button", { name: /Entregar versión/ }));
    const fichero = new File(["x"], "pieza.jpg", { type: "image/jpeg" });
    fireEvent.change(within(ficha).getByLabelText(/Imagen JPEG/), { target: { files: [fichero] } });
    fireEvent.click(within(ficha).getByRole("button", { name: /Entregar versión 1/ }));
    await waitFor(() => expect(sb.upload).toHaveBeenCalled());
    const [ruta, , opciones] = sb.upload.mock.calls[0] as [string, Blob, { contentType: string; upsert: boolean }];
    expect(ruta).toMatch(new RegExp(`^encargos/${ID_ENV}/v1-[0-9a-f]{8}\\.jpg$`));
    expect(opciones).toEqual({ contentType: "image/jpeg", upsert: false });
    await waitFor(() => expect(sb.rpc).toHaveBeenCalledWith("instagram_encargo_entregar", expect.objectContaining({ p_id: ID_ENV, p_ruta: ruta, p_portada_ruta: null })));
  });
});

describe("Avisos y calendario", () => {
  it("la campana lleva a la ficha del encargo", () => {
    expect(rutaDeAviso({ tipo: "instagram_encargo", referencia_tipo: "instagram_encargo", referencia_id: ID_REV })).toBe(`/instagram?tab=encargos&encargo=${ID_REV}`);
  });

  it("un fallo del push no rompe nada", async () => {
    sb.invoke = vi.fn(async () => {
      throw new Error("sin red");
    });
    const { avisarEncargo, llamarRpc } = await import("../api");
    await expect(avisarEncargo("ev")).resolves.toEqual({ ok: false, motivo: "sin red" });
    await expect(llamarRpc("instagram_encargo_enviar", { p_id: "x" })).resolves.toMatchObject({ ok: true, eventoId: "ev-1" });
    sb.invoke = vi.fn(async () => ({ data: { ok: false, codigo: "sin_vapid", error: "Avisos push sin configurar" }, error: null }));
    await expect(avisarEncargo("ev")).resolves.toEqual({ ok: false, motivo: "Avisos push sin configurar" });
  });

  it("el calendario pinta el hueco del encargo con su color y lo abre", async () => {
    sb.datos.instagram_encargos = [encargo({ id: ID_ENV, titulo: "Navidad", estado: "aceptado", fecha_deseada: "2026-11-06" })];
    const abrir = vi.fn();
    montar(<CalendarioInstagram onAbrirEncargo={abrir} />);
    const hueco = await screen.findByTestId("hueco-encargo");
    expect(hueco.getAttribute("aria-label")).toMatch(/Hueco de encargo ENC-0001: Navidad/);
    expect(hueco.className).toMatch(/border-dashed/);
    expect(hueco.className).toMatch(/border-blue-500/);
    fireEvent.click(hueco);
    expect(abrir).toHaveBeenCalledWith(ID_ENV);
  });
});
