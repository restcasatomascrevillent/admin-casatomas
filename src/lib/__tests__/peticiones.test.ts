// Peticiones · acceso a datos: captura (reducida o la original, límites), ruta en el cubo dentro de la carpeta
// del usuario, alta solo con las columnas del formulario, cambio de estado que la RLS no deja (sin error) y
// el iPad que se presenta como Mac.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  filas: [] as Array<{ id: string }>,
  invoke: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (v: unknown) => {
        h.insert(v);
        return { select: () => ({ single: async () => ({ data: { id: "p-1", ...(v as object) }, error: null }) }) };
      },
      update: (v: unknown) => {
        h.update(v);
        const b = { eq: () => b, select: async () => ({ data: h.filas, error: null }) };
        return b;
      },
    }),
    functions: { invoke: h.invoke },
    storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) },
  },
}));
vi.mock("@/components/carta/redimensionarFoto", () => ({ redimensionarFoto: vi.fn() }));

import { cambiarEstadoPeticion, crearPeticion, dispositivoActual, enviarALinear, pedirAnalisis, prepararCaptura, subirCaptura } from "../peticiones";

const imagen = (tipo: string, bytes = 10) => new File([new Uint8Array(bytes)], `captura.${tipo.split("/")[1]}`, { type: tipo });

beforeEach(() => {
  vi.clearAllMocks();
  h.filas = [{ id: "p-1" }];
});

describe("prepararCaptura", () => {
  it("reduce a JPEG cuando se puede", async () => {
    const reducida = new Blob([new Uint8Array(5)], { type: "image/jpeg" });
    expect(await prepararCaptura(imagen("image/png"), async () => ({ blob: reducida }))).toEqual({ blob: reducida, tipo: "image/jpeg", ext: "jpg" });
  });

  it("si no se puede reducir, la original (jpg/png/webp de hasta 5 MB)", async () => {
    const original = imagen("image/webp");
    const r = await prepararCaptura(original, async () => { throw new Error("no decodifica"); });
    expect(r).toEqual({ blob: original, tipo: "image/webp", ext: "webp" });
  });

  it("rechaza lo que no es imagen, formatos raros sin reducir y más de 5 MB", async () => {
    const falla = async () => { throw new Error("x"); };
    await expect(prepararCaptura(new File(["x"], "a.pdf", { type: "application/pdf" }), falla)).rejects.toThrow(/tiene que ser una imagen/);
    await expect(prepararCaptura(imagen("image/heic"), falla)).rejects.toThrow(/No se ha podido leer la imagen/);
    await expect(prepararCaptura(imagen("image/png", 5 * 1024 * 1024 + 1), falla)).rejects.toThrow(/más de 5 MB/);
  });
});

describe("subir y guardar", () => {
  it("la captura va a la carpeta del usuario con un nombre <uuid>.<ext>", async () => {
    const subir = vi.fn().mockResolvedValue(undefined);
    const reducida = new Blob([new Uint8Array(5)], { type: "image/jpeg" });
    const ruta = await subirCaptura(imagen("image/png"), "u-1", { subir, reducir: async () => ({ blob: reducida }), uuid: () => "1234" });
    expect(ruta).toBe("u-1/1234.jpg");
    expect(subir).toHaveBeenCalledWith("u-1/1234.jpg", reducida, "image/jpeg");
  });

  it("crearPeticion manda solo las columnas del formulario (la BD pone autor, estado y análisis)", async () => {
    await crearPeticion({ titulo: "  Hola hola  ", prioridad: "alta", modulo: "carta", descripcion: "  Descripción larga  ", ruta: "/gestion-web?tab=carta" }, "u-1");
    expect(h.insert).toHaveBeenCalledWith({
      titulo: "Hola hola", prioridad: "alta", modulo: "carta", descripcion: "Descripción larga", captura_path: null, ruta: "/gestion-web?tab=carta",
      dispositivo: expect.any(String),
    });
    const enviado = h.insert.mock.calls[0][0] as Record<string, unknown>;
    for (const k of ["creado_por", "estado", "analisis", "analisis_estado", "linear_url"]) expect(enviado).not.toHaveProperty(k);
  });

  it("pedirAnalisis llama a la Edge Function con el id (y forzar solo si se pide)", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await pedirAnalisis("p-1");
    await pedirAnalisis("p-1", true);
    expect(h.invoke).toHaveBeenNthCalledWith(1, "analizar-peticion", { body: { peticion_id: "p-1", forzar: false } });
    expect(h.invoke).toHaveBeenNthCalledWith(2, "analizar-peticion", { body: { peticion_id: "p-1", forzar: true } });
  });

  it("enviarALinear llama a la misma Edge Function con accion «enviar_linear» y lanza su error (con el motivo dentro)", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, destino: "real", identificador: "CAS-12", url: "https://linear.app/x" }, error: null });
    expect(await enviarALinear("p-1")).toMatchObject({ identificador: "CAS-12" });
    expect(h.invoke).toHaveBeenLastCalledWith("analizar-peticion", { body: { accion: "enviar_linear", peticion_id: "p-1" } });
    const error = new Error("Edge Function returned a non-2xx status code");
    h.invoke.mockResolvedValue({ data: null, error });
    await expect(enviarALinear("p-1")).rejects.toBe(error);
  });

  it("cambiar el estado: el motivo solo al descartar, y si la RLS no deja (0 filas) da error", async () => {
    await cambiarEstadoPeticion("p-1", "descartada", "  Ya existe  ");
    expect(h.update).toHaveBeenLastCalledWith({ estado: "descartada", motivo_descarte: "Ya existe" });
    await cambiarEstadoPeticion("p-1", "aceptada", "ignorado");
    expect(h.update).toHaveBeenLastCalledWith({ estado: "aceptada", motivo_descarte: null });
    h.filas = [];
    await expect(cambiarEstadoPeticion("p-1", "hecha")).rejects.toThrow(/solo el super admin/);
  });
});

describe("dispositivoActual", () => {
  it("marca el iPad que se presenta como Mac (pantalla táctil)", () => {
    expect(dispositivoActual({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toMatch(/\(iPad\)$/);
    expect(dispositivoActual({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 })).not.toMatch(/iPad/);
    expect(dispositivoActual({ userAgent: "x".repeat(500), maxTouchPoints: 0 })).toHaveLength(400);
    expect(dispositivoActual({ userAgent: "", maxTouchPoints: 0 })).toBeNull();
  });
});

describe("aviso de petición urgente en la campana", () => {
  it("lleva al ticket en Super Admin y tiene icono", async () => {
    const { rutaDeAviso, TIPO_ICON } = await import("../avisos");
    expect(rutaDeAviso({ tipo: "peticion_urgente", referencia_tipo: "peticion", referencia_id: "11111111-2222-4333-8444-555555555555" }))
      .toBe("/super-admin/tickets?ticket=11111111-2222-4333-8444-555555555555");
    expect(rutaDeAviso({ tipo: "peticion_urgente", referencia_tipo: "peticion" })).toBe("/super-admin/tickets");
    expect(TIPO_ICON.peticion_urgente).toBeDefined();
  });
});
