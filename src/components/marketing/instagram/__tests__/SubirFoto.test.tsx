/**
 * Biblioteca de fotos de Instagram en Google Drive (Edge Function
 * instagram-drive simulada con un fetch falso): el hook que lista las fotos de
 * la marca, las miniaturas pedidas con la sesión, las fotos sin clasificar, los
 * avisos (alcance drive.file) y «Subir foto» (FormData a Drive, con la foto
 * elegida al acabar). La conversión del navegador va simulada (jsdom no
 * decodifica imágenes).
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt-de-prueba" } } }) } },
}));

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

import { obtenerPlantilla, type FotoDrive, type FormatoId, type MarcaId } from "@/lib/instagram";
import { SelectorFoto } from "../SelectorFoto";
import { useFotosInstagram } from "../useFotosInstagram";
import { convertirFoto } from "../convertirFoto";
import { URL_DRIVE } from "../api";

const CHULETA: FotoDrive = { driveId: "1FotoChuleta0000000000001", nombre: "a.jpg", ancho: 1708, alto: 2560, tipo: "plato", descripcion: "Chuleta", filaId: "f1", creada: null, problema: null };
const SIN_FILA: FotoDrive = { driveId: "1FotoSinFila0000000000002", nombre: "b.jpg", ancho: 1708, alto: 2560, tipo: null, descripcion: "", filaId: null, creada: null, problema: null };
const PEQUENA: FotoDrive = { ...CHULETA, driveId: "1FotoPequena000000000003", ancho: 500, alto: 500 };
const HEIC: FotoDrive = { ...CHULETA, driveId: "1FotoHeic000000000000004", problema: "Formato HEIC: súbela desde el panel («Subir foto») para que se convierta a JPEG." };
const NUEVA = "1FotoNueva00000000000005";

// Cada recorrido espera a Drive simulado (listar, miniaturas, preparar): margen para máquinas lentas.
vi.setConfig({ testTimeout: 20_000 });

const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "content-type": "application/json" } });

const estado = {
  fotos: [] as FotoDrive[],
  avisos: [] as string[],
  alcance: "completo",
  subida: null as null | ((form: FormData) => Response),
};

function fetchFalso() {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    // Bytes y no un Blob: el Blob de jsdom no tiene stream() y el Response de Node lo rechaza.
    if (url.startsWith(`${URL_DRIVE}?accion=miniatura`)) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    if (url === `${URL_DRIVE}?accion=subir`) return estado.subida!(init.body as FormData);
    if (url === URL_DRIVE) {
      const cuerpo = JSON.parse(String(init.body));
      if (cuerpo.accion === "listar") return json({ ok: true, marca: cuerpo.marca, alcance: estado.alcance, avisos: estado.avisos, fotos: estado.fotos });
    }
    return new Response("no", { status: 404 });
  });
}

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
  estado.fotos = [];
  estado.avisos = [];
  estado.alcance = "completo";
  estado.subida = (form) => {
    const foto: FotoDrive = { driveId: NUEVA, nombre: "n.jpg", ancho: 1708, alto: 2560, tipo: String(form.get("tipo")), descripcion: String(form.get("descripcion")), filaId: "f9", creada: null, problema: null };
    estado.fotos = [foto, ...estado.fotos];
    return json({ ok: true, foto, avisos: [] });
  };
  vi.stubGlobal("fetch", fetchFalso());
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:vista"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const llamadas = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit]>;

describe("useFotosInstagram (Drive)", () => {
  it("lista las fotos de Drive de la marca con la forma del catálogo; sin fila → tipo null", async () => {
    estado.fotos = [CHULETA, SIN_FILA];
    const qc = cliente();
    const { result } = renderHook(() => useFotosInstagram("casa-tomas"), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    await waitFor(() => expect(result.current.catalogo).toHaveLength(2));
    expect(result.current.fotos[0]).toMatchObject({ id: `drive:${CHULETA.driveId}`, driveId: CHULETA.driveId, tipo: "plato", aptaPost: true, aptaStory: true, descripcion: "Chuleta", ruta: "" });
    expect(result.current.fotos[1].tipo).toBeNull();
    const [url, init] = llamadas()[0];
    expect(url).toBe(URL_DRIVE);
    expect(JSON.parse(String(init.body))).toEqual({ accion: "listar", marca: "casa-tomas" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-de-prueba");
  });

  it("con formato, solo las aptas", async () => {
    estado.fotos = [CHULETA, PEQUENA];
    const qc = cliente();
    const { result } = renderHook(() => useFotosInstagram("casa-tomas", "story"), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    await waitFor(() => expect(result.current.fotos.map((f) => f.driveId)).toEqual([CHULETA.driveId]));
  });
});

describe("SelectorFoto (Drive)", () => {
  it("pinta las miniaturas pedidas con la sesión, marca las sin clasificar y explica las que no valen", async () => {
    estado.fotos = [CHULETA, SIN_FILA, HEIC];
    const onCambio = vi.fn();
    pintar(<Selector onCambio={onCambio} />);
    const chuleta = await screen.findByTestId(`foto-drive:${CHULETA.driveId}`);
    await waitFor(() => expect(chuleta.querySelector("img")).toHaveAttribute("src", "blob:vista"));
    const mini = llamadas().find(([u]) => u.includes("accion=miniatura"))!;
    expect(mini[0]).toBe(`${URL_DRIVE}?accion=miniatura&marca=casa-tomas&id=${CHULETA.driveId}`);
    expect((mini[1].headers as Record<string, string>).Authorization).toBe("Bearer jwt-de-prueba");

    expect(within(screen.getByTestId(`foto-drive:${SIN_FILA.driveId}`)).getByText("Sin clasificar")).toBeInTheDocument();
    // La foto sin tipo vale para la plantilla; la HEIC no, y explica por qué.
    fireEvent.click(screen.getByTestId(`foto-drive:${SIN_FILA.driveId}`));
    expect(onCambio).toHaveBeenCalledWith(`drive:${SIN_FILA.driveId}`);
    const heic = screen.getByTestId(`foto-drive:${HEIC.driveId}`);
    expect(heic).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(heic);
    expect(screen.getByRole("status")).toHaveTextContent(/HEIC/);
    // Ya no se borra desde el panel: Drive es el archivo.
    expect(screen.queryByRole("button", { name: /Borrar/ })).toBeNull();
  });

  it("enseña el aviso de drive.file y el error si Drive falla", async () => {
    estado.avisos = ["El token de Google tiene el permiso «drive.file»: el panel solo ve las fotos que se suben desde aquí."];
    pintar(<Selector />);
    expect(await screen.findByTestId("aviso-biblioteca")).toHaveTextContent(/drive\.file/);
  });

  it("si la función de Drive responde error, lo dice y apunta a «Conexión»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, error: "Google Drive: respondió 404" }, 502)));
    pintar(<Selector />);
    expect(await screen.findByTestId("error-biblioteca", undefined, { timeout: 4000 })).toHaveTextContent(/No se pueden cargar las fotos de Drive: Google Drive: respondió 404.*Conexión/);
  });
});

describe("Subir foto (a Drive)", () => {
  it("prepara la foto, enseña medidas y aptitud, la sube a Drive en un FormData y la deja elegida", async () => {
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

    fireEvent.change(within(dialogo).getByLabelText("Descripción corta"), { target: { value: "  Pulpo a la brasa " } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Subir" }));

    await waitFor(() => expect(onCambio).toHaveBeenCalledWith(`drive:${NUEVA}`));
    const [, init] = llamadas().find(([u]) => u === `${URL_DRIVE}?accion=subir`)!;
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([form.get("marca"), form.get("tipo"), form.get("descripcion")]).toEqual(["casa-tomas", "plato", "Pulpo a la brasa"]);
    expect(form.get("archivo")).toBeInstanceOf(Blob);
    // El navegador pone el Content-Type multipart: no se fuerza JSON.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    const nueva = await screen.findByTestId(`foto-drive:${NUEVA}`);
    expect(nueva).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("si Drive falla, lo dice y no elige nada", async () => {
    estado.subida = () => json({ ok: false, error: "Google Drive: respondió 403", comoArreglarlo: "…" }, 502);
    const onCambio = vi.fn();
    pintar(<Selector onCambio={onCambio} />);
    fireEvent.click(screen.getByRole("button", { name: /Subir foto/ }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByTestId("entrada-foto"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await within(dialogo).findByTestId("medidas-foto");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Subir" }));
    await waitFor(() => expect(llamadas().some(([u]) => u === `${URL_DRIVE}?accion=subir`)).toBe(true));
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
    expect(llamadas().some(([u]) => u === `${URL_DRIVE}?accion=subir`)).toBe(false);
  });
});
