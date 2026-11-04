/**
 * Biblioteca de fotos de Instagram con fotos subidas desde el panel: el hook
 * que junta catálogo estático + instagram_fotos, la subida (Storage + insert,
 * con la foto elegida al acabar) y el borrado con confirmación. Supabase y la
 * conversión del navegador (jsdom no decodifica imágenes) van simulados.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sbFalso = vi.hoisted(() => {
  const estado = {
    filas: [] as Array<Record<string, unknown>>,
    usos: 0,
    upload: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
    remove: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
    insert: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
    borrar: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
  };
  return estado;
});

vi.mock("@/integrations/supabase/client", () => {
  const from = (tabla: string) => {
    if (tabla === "instagram_fotos") {
      const consulta = {
        select: () => consulta,
        order: () => consulta,
        limit: () => Promise.resolve({ data: sbFalso.filas, error: null }),
      };
      return {
        ...consulta,
        insert: (fila: unknown) => sbFalso.insert(fila),
        delete: () => ({ eq: (_c: string, id: string) => ({ select: () => sbFalso.borrar(id) }) }),
      };
    }
    // instagram_piezas: cuántas piezas usan la foto.
    const piezas = {
      select: () => piezas,
      order: () => piezas,
      limit: () => Promise.resolve({ data: [], error: null }),
      eq: () => Promise.resolve({ count: sbFalso.usos, error: null }),
    };
    return piezas;
  };
  return {
    supabase: {
      from,
      storage: { from: () => ({ upload: (...a: unknown[]) => sbFalso.upload(...a), remove: (...a: unknown[]) => sbFalso.remove(...a) }) },
    },
  };
});

vi.mock("../convertirFoto", async (original) => {
  const real = await original<typeof import("../convertirFoto")>();
  return {
    ...real,
    convertirFoto: vi.fn(async () => ({
      blob: new Blob([new Uint8Array(2048)], { type: "image/jpeg" }),
      ancho: 1708,
      alto: 2560,
      anchoOriginal: 3024,
      altoOriginal: 4032,
      calidad: 0.9,
    })),
  };
});

import { FOTOS, obtenerPlantilla, rutaFotoSubida, type FormatoId, type MarcaId } from "@/lib/instagram";
import { SelectorFoto } from "../SelectorFoto";
import { useFotosInstagram } from "../useFotosInstagram";
import { convertirFoto } from "../convertirFoto";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SUBIDA = { id: "11111111-2222-4333-8444-555555555555", marca: "casa-tomas", ruta: "", ancho: 1708, alto: 2560, tipo: "plato", descripcion: "Chuleta" };
SUBIDA.ruta = rutaFotoSubida("casa-tomas", SUBIDA.id);
const DE_TOUZA = { id: "99999999-2222-4333-8444-555555555555", marca: "touza", ruta: "", ancho: 1708, alto: 2560, tipo: "coctel", descripcion: "Mojito" };
DE_TOUZA.ruta = rutaFotoSubida("touza", DE_TOUZA.id);

function cliente() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function pintar(nodo: ReactNode) {
  return render(<QueryClientProvider client={cliente()}>{nodo}</QueryClientProvider>);
}

/** SelectorFoto con estado, como en el formulario. */
function Selector({ marca = "casa-tomas", formato = "post", onCambio }: { marca?: MarcaId; formato?: FormatoId; onCambio?: (id: string) => void }) {
  const [valor, setValor] = useState("");
  return (
    <SelectorFoto
      marca={marca}
      formato={formato}
      plantilla={obtenerPlantilla("ct-foto-titular")}
      valor={valor}
      onCambio={(id) => {
        setValor(id);
        onCambio?.(id);
      }}
      baseFotos="https://x.supabase.co/storage/v1/object/public/instagram"
    />
  );
}

beforeEach(() => {
  sbFalso.filas = [];
  sbFalso.usos = 0;
  sbFalso.upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
  sbFalso.remove = vi.fn(async () => ({ data: [], error: null }));
  // La «tabla» cambia de verdad: al volver a leerla tras invalidar, sale lo subido / no sale lo borrado.
  sbFalso.insert = vi.fn(async (fila: Record<string, unknown>) => {
    sbFalso.filas = [fila, ...sbFalso.filas];
    return { error: null };
  });
  sbFalso.borrar = vi.fn(async (id: string) => {
    sbFalso.filas = sbFalso.filas.filter((f) => f.id !== id);
    return { data: [{ id }], error: null };
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:vista"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFotosInstagram", () => {
  it("junta el catálogo estático y las filas de instagram_fotos con la misma forma", async () => {
    sbFalso.filas = [SUBIDA, DE_TOUZA, { ...SUBIDA, id: "rara", tipo: "postre" }];
    const qc = cliente();
    const { result } = renderHook(() => useFotosInstagram("casa-tomas"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.catalogo).toHaveLength(FOTOS.length + 2));
    const ids = result.current.fotos.map((f) => f.id);
    expect(ids).toEqual([...FOTOS.filter((f) => f.marca === "casa-tomas").map((f) => f.id), SUBIDA.id]);
    expect(result.current.fotos.at(-1)).toMatchObject({ subida: true, aptaPost: true, aptaStory: true, descripcion: "Chuleta" });
    expect(result.current.catalogo.map((f) => f.id)).toContain(DE_TOUZA.id);
    expect(result.current.catalogo.map((f) => f.id)).not.toContain("rara");
  });

  it("con formato, solo las aptas", async () => {
    sbFalso.filas = [SUBIDA, { ...SUBIDA, id: "22222222-2222-4333-8444-555555555555", ancho: 500, alto: 500 }];
    const qc = cliente();
    const { result } = renderHook(() => useFotosInstagram("casa-tomas", "story"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.fotos.map((f) => f.id)).toContain(SUBIDA.id));
    expect(result.current.fotos.map((f) => f.id)).not.toContain("22222222-2222-4333-8444-555555555555");
  });
});

describe("Subir foto", () => {
  it("prepara la foto, enseña medidas y aptitud, la sube con RLS, guarda la fila y la deja elegida", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(ID);
    const onCambio = vi.fn();
    pintar(<Selector onCambio={onCambio} />);

    fireEvent.click(screen.getByRole("button", { name: /Subir foto/ }));
    const dialogo = await screen.findByRole("dialog");
    const fichero = new File([new Uint8Array(10)], "IMG_0001.HEIC", { type: "image/heic" });
    fireEvent.change(within(dialogo).getByTestId("entrada-foto"), { target: { files: [fichero] } });

    expect(await within(dialogo).findByTestId("medidas-foto")).toHaveTextContent("1708×2560 px (era 3024×4032)");
    expect(convertirFoto).toHaveBeenCalledWith(fichero);
    expect(within(dialogo).getByText(/Post 1080×1350: sirve/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/Story 1080×1920: sirve/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("img", { name: "Vista previa de la foto" })).toHaveAttribute("src", "blob:vista");

    fireEvent.change(within(dialogo).getByLabelText("Descripción corta"), { target: { value: "  Pulpo a la brasa " } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Subir" }));

    await waitFor(() => expect(onCambio).toHaveBeenCalledWith(ID));
    const ruta = `fotos/casa-tomas/subidas/${ID}.jpg`;
    expect(sbFalso.upload).toHaveBeenCalledWith(ruta, expect.any(Blob), expect.objectContaining({ contentType: "image/jpeg", upsert: false }));
    expect(sbFalso.insert).toHaveBeenCalledWith({ id: ID, marca: "casa-tomas", ruta, ancho: 1708, alto: 2560, tipo: "plato", descripcion: "Pulpo a la brasa" });
    // La nueva foto ya está en la cuadrícula, marcada como subida y elegida.
    const nueva = await screen.findByTestId(`foto-${ID}`);
    expect(nueva).toHaveAttribute("aria-checked", "true");
    expect(nueva).toHaveAccessibleName(/^Subida\. Pulpo a la brasa/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("si la fila no se puede guardar, borra el fichero subido y no elige nada", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(ID);
    sbFalso.insert = vi.fn(async () => ({ error: { message: "new row violates row-level security policy" } }));
    const onCambio = vi.fn();
    pintar(<Selector onCambio={onCambio} />);
    fireEvent.click(screen.getByRole("button", { name: /Subir foto/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByTestId("entrada-foto"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await within(dialogo).findByTestId("medidas-foto");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Subir" }));
    await waitFor(() => expect(sbFalso.remove).toHaveBeenCalledWith([`fotos/casa-tomas/subidas/${ID}.jpg`]));
    expect(onCambio).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("una foto pequeña avisa de que no sirve a sangre, pero se puede subir", async () => {
    vi.mocked(convertirFoto).mockResolvedValueOnce({ blob: new Blob(["x"], { type: "image/jpeg" }), ancho: 500, alto: 500, anchoOriginal: 500, altoOriginal: 500, calidad: 0.9 });
    pintar(<Selector />);
    fireEvent.click(screen.getByRole("button", { name: /Subir foto/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByTestId("entrada-foto"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    expect(await within(dialogo).findByTestId("aviso-aptitud")).toHaveTextContent("Es pequeña: no sirve a sangre en post ni story");
    expect(within(dialogo).getByRole("button", { name: "Subir" })).toBeEnabled();
  });

  it("si el navegador no puede leer el formato, lo dice y no deja subir", async () => {
    const { ErrorFoto, MENSAJE_FORMATO_ILEGIBLE } = await vi.importActual<typeof import("../convertirFoto")>("../convertirFoto");
    vi.mocked(convertirFoto).mockRejectedValueOnce(new ErrorFoto(MENSAJE_FORMATO_ILEGIBLE));
    pintar(<Selector />);
    fireEvent.click(screen.getByRole("button", { name: /Subir foto/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByTestId("entrada-foto"), { target: { files: [new File(["x"], "a.heic", { type: "image/heic" })] } });
    expect(await within(dialogo).findByRole("alert")).toHaveTextContent("Este formato no se puede leer en este navegador; expórtala como JPEG");
    expect(within(dialogo).getByRole("button", { name: "Subir" })).toBeDisabled();
    expect(sbFalso.upload).not.toHaveBeenCalled();
  });
});

describe("Borrar una foto subida", () => {
  it("pide confirmación (avisando si la usa alguna pieza) y borra fila y fichero solo al confirmar", async () => {
    sbFalso.filas = [SUBIDA];
    sbFalso.usos = 2;
    pintar(<Selector />);
    const borrar = await screen.findByRole("button", { name: "Borrar la foto subida «Chuleta»" });
    // Las del catálogo estático no se pueden borrar.
    expect(screen.getAllByRole("button", { name: /Borrar la foto subida/ })).toHaveLength(1);

    fireEvent.click(borrar);
    const alerta = await screen.findByRole("alertdialog");
    expect(within(alerta).getByText("¿Borrar esta foto?")).toBeInTheDocument();
    expect(await within(alerta).findByTestId("aviso-foto-en-uso")).toHaveTextContent("La usan 2 piezas guardadas");
    expect(sbFalso.borrar).not.toHaveBeenCalled();

    fireEvent.click(within(alerta).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sbFalso.borrar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Borrar la foto subida «Chuleta»" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Borrar foto" }));
    await waitFor(() => expect(sbFalso.remove).toHaveBeenCalledWith([SUBIDA.ruta]));
    expect(sbFalso.borrar).toHaveBeenCalledWith(SUBIDA.id);
    await waitFor(() => expect(screen.queryByTestId(`foto-${SUBIDA.id}`)).toBeNull());
  });
});
