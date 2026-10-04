/**
 * Configuración, permiso de Marketing, cerrojo de las pasadas y fila de resumen
 * (_shared/resend-marketing/{config,servicio,repositorio}.ts y _shared/permiso-marketing.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { canalNewsletter, limiteContactos, remitenteNewsletter, nivelCuota, nombreParaResend } from "../resend-marketing/config.ts";
import { sincronizarConCerrojo, type RepoPasadas } from "../resend-marketing/servicio.ts";
import { filaResumen, RepositorioNewsletterResend } from "../resend-marketing/repositorio.ts";
import { comprobarPermisoSeccion, type ClientePermiso } from "../permiso-marketing.ts";
import type { ClienteSync, ResumenSync } from "../resend-marketing/sync.ts";

describe("config", () => {
  it("canal: solo 'broadcast' activa Resend Marketing; por defecto transaccional", () => {
    expect(canalNewsletter(undefined)).toBe("transaccional");
    expect(canalNewsletter("")).toBe("transaccional");
    expect(canalNewsletter(" Broadcast ")).toBe("broadcast");
    expect(canalNewsletter("broadcasts")).toBe("transaccional");
    expect(canalNewsletter("transaccional")).toBe("transaccional");
  });

  it("límite de contactos: 1.000 por defecto", () => {
    expect(limiteContactos(undefined)).toBe(1000);
    expect(limiteContactos("abc")).toBe(1000);
    expect(limiteContactos("-3")).toBe(1000);
    expect(limiteContactos("5000")).toBe(5000);
  });

  it("remitente: NEWSLETTER_FROM_EMAIL -> RESEND_FROM_EMAIL -> sandbox", () => {
    expect(remitenteNewsletter("CT <n@noticias.es>", "R <r@send.miguelbenito.space>")).toBe("CT <n@noticias.es>");
    expect(remitenteNewsletter("  ", "R <r@send.miguelbenito.space>")).toBe("R <r@send.miguelbenito.space>");
    expect(remitenteNewsletter(undefined, undefined)).toMatch(/onboarding@resend\.dev/);
  });

  it("aviso de cuota al 80 % y lleno al 100 %", () => {
    expect(nivelCuota(null, 1000)).toBe("ok");
    expect(nivelCuota(799, 1000)).toBe("ok");
    expect(nivelCuota(800, 1000)).toBe("aviso");
    expect(nivelCuota(999, 1000)).toBe("aviso");
    expect(nivelCuota(1000, 1000)).toBe("lleno");
    expect(nivelCuota(1200, 1000)).toBe("lleno");
  });

  it("nombre para Resend sin saltos de línea", () => {
    expect(nombreParaResend("  Ana\nMaría ")).toBe("Ana María");
    expect(nombreParaResend("")).toBeNull();
    expect(nombreParaResend(null)).toBeNull();
  });
});

describe("comprobarPermisoSeccion", () => {
  const cliente = (permitido: unknown, user: { id: string } | null = { id: "u1" }) => {
    const rpc = vi.fn(async () => ({ data: permitido, error: null }));
    const c: ClientePermiso = { auth: { getUser: async () => ({ data: { user }, error: null }) }, rpc };
    return { c, rpc };
  };

  it("leer -> can_read_section; escribir -> can_write_section", async () => {
    const a = cliente(true);
    await comprobarPermisoSeccion(a.c, "marketing", "leer");
    expect(a.rpc).toHaveBeenCalledWith("can_read_section", { _section: "marketing" });
    const b = cliente(true);
    await comprobarPermisoSeccion(b.c, "marketing", "escribir");
    expect(b.rpc).toHaveBeenCalledWith("can_write_section", { _section: "marketing" });
  });

  it("403 con el mensaje propio; 401 sin usuario", async () => {
    expect(await comprobarPermisoSeccion(cliente(false).c, "marketing", "escribir", "No puedes")).toEqual({ ok: false, status: 403, error: "No puedes" });
    expect(await comprobarPermisoSeccion(cliente(true, null).c, "marketing", "leer")).toMatchObject({ ok: false, status: 401 });
  });
});

// ---------------------------------------------------------------------------

function clienteVacio(): ClienteSync {
  const ok = <T>(data: T) => ({ ok: true as const, status: 200, data });
  return {
    listarContactos: async () => ok([]),
    listarContactosSegmento: async () => ok([]),
    listarSegmentos: async () => ok([]),
    crearSegmento: async () => ok({ id: "seg" }),
    obtenerContacto: async () => ({ ok: false as const, status: 404, tipo: "not_found", mensaje: "" }),
    crearContacto: async () => ok({ id: "c" }),
    actualizarNombre: async () => ok({}),
    borrarContacto: async () => ok({}),
    anadirASegmento: async () => ok({}),
    quitarDeSegmento: async () => ok({}),
  };
}

function repo(inicio: Awaited<ReturnType<RepoPasadas["iniciarPasada"]>>, extra: Partial<RepoPasadas> = {}) {
  const terminadas: { id: string; r: ResumenSync }[] = [];
  const r: RepoPasadas = {
    iniciarPasada: vi.fn(async () => inicio),
    terminarPasada: vi.fn(async (id: string, res: ResumenSync) => void terminadas.push({ id, r: res })),
    leerSuscriptores: async () => [{ id: "1", email: "a@x.es", nombre: null, activo: true, resend_contact_id: null }],
    leerSuprimidas: async () => new Set<string>(),
    registrarBajaNativa: async () => 0,
    marcarSincronizados: async () => {},
    ...extra,
  };
  return { r, terminadas };
}

const base = { origen: "panel" as const, usuarioId: "u1", segmentIdConfigurado: "seg", nombreSegmento: "N", log: () => {} };

describe("sincronizarConCerrojo", () => {
  it("si ya hay una pasada en curso no toca Resend", async () => {
    const cliente = clienteVacio();
    const listar = vi.spyOn(cliente, "listarContactos");
    const { r } = repo({ estado: "ocupado" });
    expect(await sincronizarConCerrojo({ ...base, repo: r, cliente })).toEqual({ tipo: "ocupado" });
    expect(listar).not.toHaveBeenCalled();
  });

  it("error al abrir la pasada (p. ej. migración sin aplicar)", async () => {
    const { r } = repo({ estado: "error", mensaje: "Falta la migración 20261003193000" });
    expect(await sincronizarConCerrojo({ ...base, repo: r, cliente: clienteVacio() })).toEqual({ tipo: "error", mensaje: "Falta la migración 20261003193000" });
  });

  it("sincroniza, ejecuta lo de dentro del cerrojo con el resumen y cierra la pasada", async () => {
    const { r, terminadas } = repo({ estado: "ok", id: "p1" });
    const dentro = vi.fn(async (res: ResumenSync) => `enviado a ${res.destinatarios}`);
    const res = await sincronizarConCerrojo({ ...base, repo: r, cliente: clienteVacio() }, dentro);
    expect(res).toMatchObject({ tipo: "hecho", pasadaId: "p1", extra: "enviado a 1" });
    expect(dentro).toHaveBeenCalledTimes(1);
    expect(terminadas).toHaveLength(1);
    expect(terminadas[0]).toMatchObject({ id: "p1", r: { estado: "ok", altas: 1 } });
  });

  it("la pasada se cierra aunque lo de dentro del cerrojo reviente", async () => {
    const { r, terminadas } = repo({ estado: "ok", id: "p2" });
    await expect(
      sincronizarConCerrojo({ ...base, repo: r, cliente: clienteVacio() }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(terminadas).toHaveLength(1);
    expect(terminadas[0].r.estado).toBe("error");
  });
});

describe("filaResumen", () => {
  it("guarda contadores y errores sin emails", () => {
    const fila = filaResumen(
      {
        estado: "parcial",
        segmentId: "seg",
        segmentoCreado: false,
        contactosResend: 10,
        contactosSegmento: 9,
        ajenos: 1,
        destinatarios: 9,
        altas: 2,
        actualizados: 1,
        anadidosSegmento: 3,
        quitadosSegmento: 0,
        borrados: 1,
        bajasResend: 1,
        errores: [{ suscriptorId: "s1", accion: "crear", mensaje: "422 validation_error: bad" }],
        pendientes: 0,
        bloqueaEnvio: false,
        peticiones: 12,
        mensajeError: null,
      },
      new Date("2026-10-03T10:00:00Z"),
    );
    expect(fila).toMatchObject({
      estado: "parcial",
      terminada_at: "2026-10-03T10:00:00.000Z",
      contactos_resend: 10,
      destinatarios: 9,
      altas: 2,
      actualizados: 4,
      borrados: 1,
      bajas_resend: 1,
      errores: 1,
    });
    expect(JSON.stringify(fila)).not.toMatch(/@/);
  });
});

describe("RepositorioNewsletterResend.iniciarPasada", () => {
  function db(insertError: { code?: string; message?: string } | null) {
    const llamadas: string[] = [];
    const cadena = (resultado: unknown) => {
      const q: Record<string, unknown> = {};
      for (const m of ["update", "eq", "lt", "insert", "select"]) q[m] = (..._a: unknown[]) => (llamadas.push(m), q);
      q.single = async () => resultado;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(resultado).then(res);
      return q;
    };
    let n = 0;
    return {
      llamadas,
      from: () => (n++ === 0 ? cadena({ error: null }) : cadena(insertError ? { data: null, error: insertError } : { data: { id: "p9" }, error: null })),
    };
  }

  it("abre la pasada", async () => {
    expect(await new RepositorioNewsletterResend(db(null)).iniciarPasada("panel", "u1")).toEqual({ estado: "ok", id: "p9" });
  });
  it("23505 (índice único parcial) = ocupado", async () => {
    expect(await new RepositorioNewsletterResend(db({ code: "23505", message: "duplicate key" })).iniciarPasada("cron", null)).toEqual({ estado: "ocupado" });
  });
  it("tabla inexistente -> pide aplicar la migración", async () => {
    const r = await new RepositorioNewsletterResend(db({ code: "42P01", message: 'relation "newsletter_sincronizaciones_resend" does not exist' })).iniciarPasada("panel", "u1");
    expect(r.estado).toBe("error");
    expect(r.estado === "error" && r.mensaje).toMatch(/20261003193000/);
  });
});
