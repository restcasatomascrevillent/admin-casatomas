import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AvisoInstalarApp, InstalarApp, TEXTO_AYUDA_IOS } from "../InstalarApp";
import { escucharInstalacion, reiniciarInstalacion } from "@/lib/instalarApp";

const uaOriginal = navigator.userAgent;

function ponerUA(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function ponerMedia({ standalone = false, movil = true } = {}) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes("display-mode") ? standalone : q.includes("max-width") ? movil : false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function lanzarBeforeInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const evento = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  evento.prompt = vi.fn().mockResolvedValue(undefined);
  evento.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(evento);
  });
  return evento;
}

beforeEach(() => {
  reiniciarInstalacion();
  escucharInstalacion();
  ponerUA("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile");
  ponerMedia();
  try {
    localStorage.clear();
  } catch {
    /* nada */
  }
});

afterEach(() => {
  ponerUA(uaOriginal);
});

describe("InstalarApp (menú lateral)", () => {
  it("sin el evento del navegador y fuera de iPhone no pinta nada", () => {
    const { container } = render(<InstalarApp />);
    expect(container).toBeEmptyDOMElement();
  });

  it("en Android, al llegar beforeinstallprompt sale el botón y llama a prompt()", async () => {
    render(<InstalarApp />);
    const evento = lanzarBeforeInstallPrompt();
    expect(evento.defaultPrevented).toBe(true);
    const boton = screen.getByRole("button", { name: "Instalar app" });
    await act(async () => {
      fireEvent.click(boton);
    });
    expect(evento.prompt).toHaveBeenCalledTimes(1);
    // Aceptada: ya no se ofrece otra vez.
    expect(screen.queryByRole("button", { name: "Instalar app" })).toBeNull();
  });

  it("en iPhone (sin evento) explica el gesto de Compartir", async () => {
    ponerUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    render(<InstalarApp />);
    fireEvent.click(screen.getByRole("button", { name: "Instalar app" }));
    expect(await screen.findByText(TEXTO_AYUDA_IOS)).toBeInTheDocument();
  });

  it("ya instalada (display-mode: standalone) no pinta nada", () => {
    ponerMedia({ standalone: true });
    const { container } = render(<InstalarApp />);
    lanzarBeforeInstallPrompt();
    expect(container).toBeEmptyDOMElement();
  });

  it("ya instalada en iPhone (navigator.standalone) no pinta nada", () => {
    ponerUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    const { container } = render(<InstalarApp />);
    expect(container).toBeEmptyDOMElement();
    Object.defineProperty(window.navigator, "standalone", { value: undefined, configurable: true });
  });
});

describe("AvisoInstalarApp (primera vez en el móvil)", () => {
  it("sale en el móvil y la ✕ lo descarta para siempre", () => {
    ponerUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    const { unmount } = render(<AvisoInstalarApp />);
    expect(screen.getByTestId("aviso-instalar-app")).toHaveTextContent(TEXTO_AYUDA_IOS);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso de instalar" }));
    expect(screen.queryByTestId("aviso-instalar-app")).toBeNull();
    unmount();
    render(<AvisoInstalarApp />);
    expect(screen.queryByTestId("aviso-instalar-app")).toBeNull();
  });

  it("en Android ofrece «Instalar» y lanza el diálogo", async () => {
    render(<AvisoInstalarApp />);
    const evento = lanzarBeforeInstallPrompt("dismissed");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Instalar" }));
    });
    expect(evento.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("aviso-instalar-app")).toBeNull();
  });

  it("en pantalla grande no sale", () => {
    ponerMedia({ movil: false });
    ponerUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    render(<AvisoInstalarApp />);
    expect(screen.queryByTestId("aviso-instalar-app")).toBeNull();
  });

  it("si localStorage falla, se muestra igual y se puede cerrar", () => {
    ponerUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1");
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    render(<AvisoInstalarApp />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso de instalar" }));
    expect(screen.queryByTestId("aviso-instalar-app")).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});
