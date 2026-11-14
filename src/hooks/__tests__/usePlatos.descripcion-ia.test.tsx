// Tarea 2.2 · al crear un plato sin descripción, la escribe la IA en la misma
// llamada de traducción y se avisa con «Descripción escrita por la IA:
// revísala». Una descripción escrita por el usuario nunca se toca, y si la
// función falla el plato se guarda sin descripción, como hasta ahora.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AVISO_DESCRIPCION_IA, usePlatos, type NuevoPlato } from "../usePlatos";

const bd = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/rebuild-webs", () => ({ notificarGuardadoYPublicacion: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: () => {
      const respuesta = { data: { id: "p1" }, error: null };
      const q = {
        select: () => q,
        order: () => q,
        eq: () => q,
        single: async () => respuesta,
        insert: (dato: unknown) => {
          bd.insert(dato);
          return q;
        },
        update: (dato: unknown) => {
          bd.update(dato);
          return q;
        },
        then: (fn: (dato: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(fn),
      };
      return q;
    },
  },
}));

const invoke = vi.mocked(supabase.functions.invoke);

const TRADUCCION = {
  nombre_en: "Wild Meagre",
  categoria_en: "Fish",
  alergenos_en: "fish",
  nombre_fr: "Maigre sauvage",
  categoria_fr: "Poissons",
  alergenos_fr: "poisson",
};
const GENERADA = {
  ...TRADUCCION,
  descripcion_es: "Corvina salvaje, un pescado blanco de carne firme.",
  descripcion_en: "Wild meagre, a firm white fish.",
  descripcion_fr: "Maigre sauvage, un poisson blanc à chair ferme.",
};
const responde = (translations: Record<string, unknown>) =>
  invoke.mockResolvedValue({ data: { ok: true, tipo: "plato", translations }, error: null } as never);

const PLATO: NuevoPlato = {
  nombre: "Corvina salvaje",
  categoria: "PESCADOS",
  precio_eur: 24,
  ingredientes: "Corvina",
  alergenos_oficiales: ["pescado"],
};

function preparar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(["platos"], [
    { id: "p1", nombre: "Corvina salvaje", categoria: "PESCADOS", descripcion: null, alergenos_oficiales: ["pescado"] },
  ]);
  return renderHook(() => usePlatos(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

async function crear(plato: NuevoPlato) {
  const { result } = preparar();
  await act(async () => {
    await result.current.crearPlato.mutateAsync(plato);
  });
}

const insertado = () => bd.insert.mock.calls[0][0][0] as Record<string, unknown>;
const cuerpo = () => (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body;

describe("crear un plato sin descripción", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pide la descripción en la misma llamada de traducción", async () => {
    responde(GENERADA);
    await crear(PLATO);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("traducir-contenido", expect.anything());
    expect(cuerpo()).toMatchObject({
      tipo: "plato",
      redactar_descripcion: true,
      datos: { nombre: "Corvina salvaje", descripcion: "", ingredientes: "Corvina", categoria: "PESCADOS", alergenos: ["pescado"] },
    });
  });

  it("guarda la descripción de la IA con sus traducciones y avisa para revisarla", async () => {
    responde(GENERADA);
    await crear(PLATO);
    expect(insertado()).toMatchObject({
      descripcion: "Corvina salvaje, un pescado blanco de carne firme.",
      descripcion_en: "Wild meagre, a firm white fish.",
      descripcion_fr: "Maigre sauvage, un poisson blanc à chair ferme.",
      nombre_en: "Wild Meagre",
    });
    // descripcion_es no es una columna de Platos: no puede llegar al INSERT.
    expect(insertado()).not.toHaveProperty("descripcion_es");
    expect(AVISO_DESCRIPCION_IA).toBe("Descripción escrita por la IA: revísala");
    expect(toast.info).toHaveBeenCalledWith(AVISO_DESCRIPCION_IA, {
      description: "Corvina salvaje, un pescado blanco de carne firme.",
    });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("una descripción de solo espacios cuenta como vacía", async () => {
    responde(GENERADA);
    await crear({ ...PLATO, descripcion: "   " });
    expect(cuerpo().redactar_descripcion).toBe(true);
    expect(insertado().descripcion).toBe("Corvina salvaje, un pescado blanco de carne firme.");
  });

  it("si la IA no la redacta, se guarda sin descripción y sin aviso de IA", async () => {
    responde({ ...TRADUCCION, descripcion_en: null, descripcion_fr: null });
    await crear(PLATO);
    expect(insertado()).toMatchObject({ descripcion: null, descripcion_en: null, descripcion_fr: null, nombre_en: "Wild Meagre" });
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("nunca guarda traducciones de una descripción en español que no llegó", async () => {
    responde({ ...TRADUCCION, descripcion_es: "", descripcion_en: "Orphan text.", descripcion_fr: "Texte orphelin." });
    await crear(PLATO);
    expect(insertado()).toMatchObject({ descripcion: null, descripcion_en: null, descripcion_fr: null });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it.each([
    ["la función responde ok:false", () => invoke.mockResolvedValue({ data: { ok: false, error: "OpenAI 500" }, error: null } as never)],
    ["la llamada da error", () => invoke.mockResolvedValue({ data: null, error: new Error("red") } as never)],
    ["la llamada lanza", () => invoke.mockRejectedValue(new Error("caída"))],
  ])("si %s, se guarda sin descripción, como hasta ahora", async (_n, fallar) => {
    fallar();
    await crear(PLATO);
    expect(bd.insert).toHaveBeenCalledTimes(1);
    expect(insertado().descripcion).toBeNull();
    expect(insertado()).not.toHaveProperty("descripcion_en");
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/sin traducción automática/));
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("crear un plato con descripción escrita", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no pide redactar y guarda el texto del usuario tal cual", async () => {
    responde({ ...TRADUCCION, descripcion_en: "Grilled fish of the day.", descripcion_fr: "Poisson du jour grillé." });
    await crear({ ...PLATO, descripcion: "Pescado del día a la plancha." });
    expect(cuerpo()).not.toHaveProperty("redactar_descripcion");
    expect(insertado()).toMatchObject({
      descripcion: "Pescado del día a la plancha.",
      descripcion_en: "Grilled fish of the day.",
    });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("aunque la función devolviera una descripción, no sustituye la del usuario", async () => {
    responde(GENERADA);
    await crear({ ...PLATO, descripcion: "Pescado del día a la plancha." });
    expect(insertado().descripcion).toBe("Pescado del día a la plancha.");
    expect(insertado()).not.toHaveProperty("descripcion_es");
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("editar un plato no cambia", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vaciar la descripción al editar no la pide a la IA ni guarda descripcion_es", async () => {
    responde(GENERADA);
    const { result } = preparar();
    await act(async () => {
      await result.current.actualizarPlato.mutateAsync({ id: "p1", nombre: "Corvina salvaje a la sal", descripcion: "" });
    });
    expect(cuerpo()).not.toHaveProperty("redactar_descripcion");
    const actualizado = bd.update.mock.calls[0][0] as Record<string, unknown>;
    expect(actualizado.descripcion).toBe("");
    expect(actualizado).not.toHaveProperty("descripcion_es");
    expect(toast.info).not.toHaveBeenCalled();
  });
});
