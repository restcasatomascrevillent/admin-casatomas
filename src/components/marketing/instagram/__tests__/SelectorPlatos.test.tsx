/**
 * Pestaña «Platos» del selector de fotos (árbol de Drive Platos/<categoría>/<plato>):
 * categoría → plato → fotos, que no se mezclan con «Todas» ni «Drive», que se
 * eligen como cualquier foto de Drive, y que Touza no la tiene.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt-de-prueba" } } }) } },
}));

import { obtenerPlantilla, type FotoDrive, type MarcaId } from "@/lib/instagram";
import { SelectorFoto } from "../SelectorFoto";
import { URL_DRIVE } from "../api";

const foto = (driveId: string, nombre: string): FotoDrive => ({ driveId, nombre, ancho: 3000, alto: 2000, tipo: null, descripcion: nombre, filaId: null, creada: null, problema: null });
const SUELTA = foto("1FotoSuelta00000000000001", "suelta.jpg");
const ORIGINAL = foto("1FotoOriginal00000000000002", "ORIGINAL - Chuletón.jpg");
const TOMA = foto("1FotoToma0000000000000003", "Chuletón - IMG_1.jpg");
const ARBOL = {
  ok: true,
  alcance: "completo",
  avisos: [],
  truncado: false,
  categorias: [
    { id: "cat-carnes", nombre: "09 Carnes", platos: [{ id: "pl-chuleton", nombre: "Chuletón", fotos: [ORIGINAL, TOMA] }, { id: "pl-vacio", nombre: "Entrecot", fotos: [] }] },
    { id: "cat-postres", nombre: "11 Postres", platos: [{ id: "pl-flan", nombre: "Flan", fotos: [] }] },
  ],
};

const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
let arbolFalla = false;

beforeEach(() => {
  arbolFalla = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.startsWith(`${URL_DRIVE}?accion=miniatura`)) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      if (url === URL_DRIVE) {
        const c = JSON.parse(String(init.body));
        if (c.accion === "listar") return json({ ok: true, marca: c.marca, alcance: "completo", avisos: [], fotos: [SUELTA] });
        if (c.accion === "listar_platos") return arbolFalla ? json({ ok: false, error: "Drive no responde" }, 502) : json(ARBOL);
      }
      return new Response("no", { status: 404 });
    }),
  );
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:vista"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Selector({ marca = "casa-tomas", onCambio }: { marca?: MarcaId; onCambio?: (id: string) => void }) {
  const [valor, setValor] = useState("");
  return (
    <SelectorFoto
      marca={marca}
      formato="post"
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
const pintar = (nodo: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{nodo}</QueryClientProvider>);

describe("SelectorFoto · pestaña Platos", () => {
  it("las fotos del árbol solo cuentan en «Platos»: «Todas» y «Drive» siguen con las de siempre", async () => {
    pintar(<Selector />);
    await waitFor(() => expect(screen.getByTestId("filtro-origen-platos").textContent).toBe("Platos (2)"));
    expect(screen.getByTestId("filtro-origen-todas").textContent).toBe("Todas (1)");
    expect(screen.getByTestId("filtro-origen-drive").textContent).toBe("Drive (1)");
    expect(screen.queryByTestId(`foto-drive:${ORIGINAL.driveId}`)).toBeNull();
  });

  it("categoría → plato → fotos; solo los platos con fotos; elegir una foto da su id de Drive", async () => {
    const onCambio = vi.fn();
    pintar(<Selector onCambio={onCambio} />);
    await waitFor(() => expect(screen.getByTestId("filtro-origen-platos").textContent).toBe("Platos (2)"));
    fireEvent.click(screen.getByTestId("filtro-origen-platos"));
    expect(screen.getByText("Elige una categoría.")).toBeTruthy();
    expect((screen.getByTestId("categoria-cat-postres") as HTMLButtonElement).disabled).toBe(true); // sin fotos
    fireEvent.click(screen.getByTestId("categoria-cat-carnes"));
    expect(screen.queryByTestId("plato-pl-vacio")).toBeNull();
    expect(screen.getByTestId("plato-pl-chuleton").textContent).toBe("Chuletón (2)");
    fireEvent.click(screen.getByTestId("plato-pl-chuleton"));
    fireEvent.click(await screen.findByTestId(`foto-drive:${ORIGINAL.driveId}`));
    expect(screen.getByTestId(`foto-drive:${TOMA.driveId}`)).toBeTruthy();
    expect(onCambio).toHaveBeenCalledWith(`drive:${ORIGINAL.driveId}`);
  });

  it("si el árbol falla se avisa solo en su pestaña, y Touza no tiene pestaña «Platos»", async () => {
    arbolFalla = true;
    const a = pintar(<Selector />);
    await waitFor(() => expect(screen.getByTestId("filtro-origen-drive").textContent).toBe("Drive (1)"));
    expect(screen.queryByTestId("error-arbol")).toBeNull();
    fireEvent.click(screen.getByTestId("filtro-origen-platos"));
    expect((await screen.findByTestId("error-arbol")).textContent).toMatch(/Drive no responde/);
    a.unmount();
    pintar(<Selector marca="touza" />);
    await waitFor(() => expect(screen.getByTestId("filtro-origen-drive")).toBeTruthy());
    expect(screen.queryByTestId("filtro-origen-platos")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([, i]) => String((i as RequestInit | undefined)?.body).includes('"marca":"touza"') && String((i as RequestInit).body).includes("listar_platos"))).toBe(false);
  });
});
