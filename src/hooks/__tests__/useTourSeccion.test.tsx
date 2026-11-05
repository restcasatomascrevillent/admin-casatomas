import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

interface ConfigFalsa {
  steps: { element?: Element }[];
  onNextClick: () => void;
  onPrevClick: () => void;
  onDestroyStarted: () => void;
}
// driver.js de mentira: guarda el índice activo como el de verdad.
let activo: number | undefined;
const drive = vi.fn((i: number) => {
  activo = i;
});
const moveTo = vi.fn((i: number) => {
  activo = i;
});
const destroy = vi.fn();
const driverMock = vi.fn((_config: ConfigFalsa) => ({
  drive,
  moveTo,
  destroy,
  isActive: () => activo !== undefined,
  getActiveIndex: () => activo,
}));
vi.mock("driver.js", () => ({ driver: (config: ConfigFalsa) => driverMock(config) }));
vi.mock("driver.js/dist/driver.css", () => ({}));
vi.mock("@/components/ayuda/tour.css", () => ({}));

let usuario: { id: string; user_metadata?: Record<string, unknown> } | null = null;
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
const updateUser = vi.fn(async (_datos: unknown) => ({ data: {}, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { updateUser: (datos: unknown) => updateUser(datos) } },
}));

import { useTourSeccion } from "../useTourSeccion";
import { TOURS, claveTourVisto, esCambioDePestanaDelTour } from "@/lib/ayuda/tours";

const envoltorio = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

describe("useTourSeccion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    driverMock.mockClear();
    drive.mockClear();
    moveTo.mockClear();
    destroy.mockClear();
    activo = undefined;
    localStorage.clear();
    usuario = null;
    updateUser.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("«lanzar» arranca en el primer paso y los opcionales que no aparecen se quitan (y el total baja)", async () => {
    const { result } = renderHook(() => useTourSeccion("facturas", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(drive).toHaveBeenCalledWith(0);
    const config = driverMock.mock.calls[0][0];
    expect(config.steps.length).toBe(TOURS.facturas.length);

    // Recorre todo: sin pantalla real no hay elementos, así que solo quedan los obligatorios.
    for (let i = 0; i < 30 && activo !== undefined && destroy.mock.calls.length === 0; i++) {
      await act(async () => {
        config.onNextClick();
        await vi.advanceTimersByTimeAsync(2500);
      });
    }
    expect(config.steps.length).toBe(TOURS.facturas.filter((p) => !p.opcional).length);
    expect(destroy).toHaveBeenCalled();
  });

  it("abre la pestaña de cada paso (mousedown, como Radix) y al terminar vuelve a la que estaba", async () => {
    document.body.innerHTML = `
      <button data-tour="facturas-pestana-cargar" aria-selected="false"></button>
      <button data-tour="facturas-pestana-compras" aria-selected="true"></button>
      <button data-tour="facturas-pestana-ia" aria-selected="false"></button>`;
    const pulsadas: string[] = [];
    document.querySelectorAll("button").forEach((b) =>
      b.addEventListener("mousedown", () => {
        pulsadas.push(b.getAttribute("data-tour") ?? "");
        document.querySelectorAll("button").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
      }),
    );
    const { result } = renderHook(() => useTourSeccion("facturas", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    await act(async () => {
      config.onNextClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(pulsadas).toEqual(["facturas-pestana-cargar"]);

    await act(async () => config.onDestroyStarted());
    expect(pulsadas.at(-1)).toBe("facturas-pestana-compras");
    document.body.innerHTML = "";
  });

  it("hacia atrás desde Novedades vuelve a Vinos abriendo antes Carta y luego la subpestaña", async () => {
    document.body.innerHTML = `
      <button class="top" data-tour="gw-pestana-carta" aria-selected="true"></button>
      <button class="top" data-tour="gw-pestana-novedades" aria-selected="false"></button>
      <button class="sub" data-tour="gw-carta-vinos" aria-selected="false"></button>
      <div data-tour="gw-carta-vinos-foto"></div>`;
    const sel = (id: string) => document.querySelector<HTMLElement>(`[data-tour="${id}"]`)!;
    const abierta = (id: string) => sel(id).getAttribute("aria-selected") === "true";
    const visibleSi = (el: HTMLElement, cond: () => boolean) => {
      el.getClientRects = () => (cond() ? [{}] : []) as unknown as DOMRectList;
    };
    visibleSi(sel("gw-pestana-carta"), () => true);
    visibleSi(sel("gw-pestana-novedades"), () => true);
    // La subpestaña y su contenido solo se ven con Carta abierta (si no, siguen en el DOM, ocultos).
    visibleSi(sel("gw-carta-vinos"), () => abierta("gw-pestana-carta"));
    visibleSi(sel("gw-carta-vinos-foto"), () => abierta("gw-pestana-carta") && abierta("gw-carta-vinos"));
    const pulsadas: string[] = [];
    document.querySelectorAll<HTMLElement>("button").forEach((b) =>
      b.addEventListener("mousedown", () => {
        pulsadas.push(b.getAttribute("data-tour") ?? "");
        if (b.classList.contains("top")) {
          document.querySelectorAll(".top").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
        } else {
          b.setAttribute("aria-selected", "true");
        }
      }),
    );
    const { result } = renderHook(() => useTourSeccion("gestor-web", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    const actual = () => config.steps[activo ?? -1]?.element;

    for (let i = 0; i < 30 && actual() !== sel("gw-pestana-novedades"); i++) {
      await act(async () => {
        config.onNextClick();
        await vi.advanceTimersByTimeAsync(2500);
      });
    }
    expect(actual()).toBe(sel("gw-pestana-novedades"));
    expect(abierta("gw-pestana-carta")).toBe(false);

    pulsadas.length = 0;
    await act(async () => {
      config.onPrevClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(pulsadas).toEqual(["gw-pestana-carta"]);
    expect(actual()).toBe(sel("gw-carta-vinos-foto"));

    // Con la subpestaña ya en Vinos solo hace falta abrir Carta; si no, también la pulsa.
    sel("gw-carta-vinos").setAttribute("aria-selected", "false");
    await act(async () => {
      config.onNextClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    pulsadas.length = 0;
    await act(async () => {
      config.onPrevClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(pulsadas).toEqual(["gw-pestana-carta", "gw-carta-vinos"]);
    expect(actual()).toBe(sel("gw-carta-vinos-foto"));
    document.body.innerHTML = "";
  });

  it("sus cambios de pestaña van marcados como del tour (sin historial); los del usuario no", async () => {
    document.body.innerHTML = `
      <button data-tour="facturas-pestana-cargar" aria-selected="false"></button>
      <button data-tour="facturas-pestana-compras" aria-selected="true"></button>`;
    const marcas: boolean[] = [];
    document.querySelectorAll("button").forEach((b) =>
      b.addEventListener("mousedown", () => {
        marcas.push(esCambioDePestanaDelTour());
        document.querySelectorAll("button").forEach((o) => o.setAttribute("aria-selected", String(o === b)));
      }),
    );
    const { result } = renderHook(() => useTourSeccion("facturas", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    await act(async () => {
      config.onNextClick();
      await vi.advanceTimersByTimeAsync(2500);
    });
    await act(async () => config.onDestroyStarted());
    // Ida (Cargar) y vuelta (Compras), las dos del tour.
    expect(marcas).toEqual([true, true]);
    expect(esCambioDePestanaDelTour()).toBe(false);
    document.body.innerHTML = "";
  });

  it("si abre el panel de la IA, lo vuelve a cerrar al acabar el tour", async () => {
    document.body.innerHTML = `
      <button data-tour="facturas-pestana-ia" aria-selected="true"></button>
      <div data-tour="facturas-ia-pregunta">
        <button data-tour="facturas-ia-abrir" aria-expanded="false"></button>
      </div>`;
    const visible = () => [{}] as unknown as DOMRectList;
    const bloque = document.querySelector<HTMLElement>('[data-tour="facturas-ia-pregunta"]')!;
    const abrir = document.querySelector<HTMLElement>('[data-tour="facturas-ia-abrir"]')!;
    bloque.getClientRects = visible;
    abrir.getClientRects = visible;
    abrir.addEventListener("click", () =>
      abrir.setAttribute("aria-expanded", String(abrir.getAttribute("aria-expanded") !== "true")),
    );
    const { result } = renderHook(() => useTourSeccion("facturas", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    for (let i = 0; i < 30 && abrir.getAttribute("aria-expanded") !== "true"; i++) {
      await act(async () => {
        config.onNextClick();
        await vi.advanceTimersByTimeAsync(2500);
      });
    }
    expect(abrir.getAttribute("aria-expanded")).toBe("true");

    await act(async () => config.onDestroyStarted());
    expect(abrir.getAttribute("aria-expanded")).toBe("false");
    document.body.innerHTML = "";
  });

  it("no cierra el panel de la IA si ya estaba abierto antes del tour", async () => {
    document.body.innerHTML = `
      <button data-tour="facturas-pestana-ia" aria-selected="true"></button>
      <div data-tour="facturas-ia-pregunta">
        <button data-tour="facturas-ia-abrir" aria-expanded="true"></button>
      </div>`;
    const abrir = document.querySelector<HTMLElement>('[data-tour="facturas-ia-abrir"]')!;
    const clic = vi.fn();
    abrir.addEventListener("click", clic);
    const { result } = renderHook(() => useTourSeccion("facturas", { auto: false }), { wrapper: envoltorio });
    await act(async () => {
      result.current.lanzar();
      await vi.advanceTimersByTimeAsync(0);
    });
    const config = driverMock.mock.calls[0][0];
    for (let i = 0; i < 30 && activo !== undefined && destroy.mock.calls.length === 0; i++) {
      await act(async () => {
        config.onNextClick();
        await vi.advanceTimersByTimeAsync(2500);
      });
    }
    await act(async () => config.onDestroyStarted());
    expect(clic).not.toHaveBeenCalled();
    expect(abrir.getAttribute("aria-expanded")).toBe("true");
    document.body.innerHTML = "";
  });

  it("se lanza solo la primera vez y lo recuerda por usuario", () => {
    usuario = { id: "u1" };
    const { unmount } = renderHook(() => useTourSeccion("facturas"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(claveTourVisto("facturas", "u1"))).toBe("1");
    unmount();

    renderHook(() => useTourSeccion("facturas"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).toHaveBeenCalledTimes(1);
  });

  it("lo apunta también en la cuenta, para que no vuelva a salir en otro navegador o dirección", () => {
    usuario = { id: "u-cuenta", user_metadata: { ayuda_tours_vistos: ["gestor-web"] } };
    renderHook(() => useTourSeccion("facturas"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ data: { ayuda_tours_vistos: ["facturas", "gestor-web"] } });
  });

  it("no se lanza solo si la cuenta ya lo tiene visto, aunque este navegador no lo sepa", () => {
    usuario = { id: "u-otro-movil", user_metadata: { ayuda_tours_vistos: ["facturas"] } };
    renderHook(() => useTourSeccion("facturas"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).not.toHaveBeenCalled();
    expect(localStorage.getItem(claveTourVisto("facturas", "u-otro-movil"))).toBe("1");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("si solo lo sabía este navegador, lo sube a la cuenta sin relanzarlo", () => {
    usuario = { id: "u-antiguo" };
    localStorage.setItem(claveTourVisto("gestor-web", "u-antiguo"), "1");
    renderHook(() => useTourSeccion("gestor-web"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith({ data: { ayuda_tours_vistos: ["gestor-web"] } });
  });

  it("sin usuario no se lanza solo", () => {
    renderHook(() => useTourSeccion("gestor-web"), { wrapper: envoltorio });
    act(() => vi.advanceTimersByTime(1000));
    expect(drive).not.toHaveBeenCalled();
  });
});
