import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../useAuth";
import { supabase } from "@/integrations/supabase/client";

const state = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: unknown) => void),
  remote: null as
    | null
    | ((payload: { new: { access_blocked: boolean } }) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((cb) => {
        state.callback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      getSession: vi.fn(),
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      setSession: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(() => ({
      on: vi.fn(function (_event, _filter, callback) {
        state.remote = callback;
        return this;
      }),
      subscribe: vi.fn(function () {
        return this;
      }),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const user = { id: "user-id", email: "user@test.local" };
const session = { user, access_token: "token", refresh_token: "refresh" };
beforeEach(() => {
  vi.clearAllMocks();
  state.remote = null;
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: null },
    error: null,
  });
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user },
    error: null,
  } as never);
  vi.mocked(supabase.rpc).mockImplementation(
    (name: string) =>
      Promise.resolve({
        data: name === "version_auditoria_panel" ? 2 : "audit-1",
        error: null,
      }) as never,
  );
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: { user, session },
    error: null,
  });
});
const mount = async () => {
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};
describe("accesos auditados", () => {
  it("espera el registro de salida antes de invalidar la sesión", async () => {
    const { result } = await mount();
    let finish!: (value: unknown) => void;
    vi.mocked(supabase.rpc).mockImplementation((name: string) =>
      name === "version_auditoria_panel"
        ? (Promise.resolve({ data: 2, error: null }) as never)
        : (new Promise((resolve) => {
            finish = resolve;
          }) as never),
    );
    let pending!: ReturnType<typeof result.current.signOut>;
    act(() => {
      pending = result.current.signOut();
    });
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    await act(async () => {
      finish({ error: null });
      await pending;
    });
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "registrar_acceso_panel",
      expect.objectContaining({ p_tipo: "logout" }),
    );
  });
  it("comunica un fallo al registrar la salida", async () => {
    const { result } = await mount();
    vi.mocked(supabase.rpc).mockImplementation(
      (name: string) =>
        Promise.resolve(
          name === "version_auditoria_panel"
            ? { data: 2, error: null }
            : { error: { message: "failed" } },
        ) as never,
    );
    let response!: Awaited<ReturnType<typeof result.current.signOut>>;
    await act(async () => {
      response = await result.current.signOut();
    });
    expect(response.error?.message).toContain("auditoría");
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });
  it("envía el login al servidor y solo instala la sesión que ya se ha auditado", async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.signIn("user@test.local", "password");
    });
    expect(supabase.functions.invoke).toHaveBeenCalledWith("panel-auth", {
      body: { email: "user@test.local", password: "password", ruta: "/" },
    });
    expect(supabase.auth.setSession).toHaveBeenCalledWith(session);
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
    await act(async () => {
      state.callback?.("SIGNED_IN", session);
    });
    await waitFor(() => expect(result.current.user?.id).toBe(user.id));
    expect(
      vi
        .mocked(supabase.rpc)
        .mock.calls.filter((c) => c[0] === "registrar_acceso_panel"),
    ).toHaveLength(0);
  });
  it("no permite entrar si el servidor no pudo registrar el intento", async () => {
    const { result } = await mount();
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
      data: null,
      error: new Error("unavailable"),
    });
    let response!: Awaited<ReturnType<typeof result.current.signIn>>;
    await act(async () => {
      response = await result.current.signIn("user@test.local", "password");
    });
    expect(response.error).toBeTruthy();
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });
  it("restaurar una sesión registra acceso; renovar JWT o enfocar no lo duplica", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
      data: { session },
      error: null,
    } as never);
    const { result } = await mount();
    expect(result.current.user?.id).toBe(user.id);
    await act(async () => {
      state.callback?.("TOKEN_REFRESHED", {
        ...session,
        access_token: "refreshed",
      });
    });
    await act(async () => {
      state.callback?.("SIGNED_IN", session);
    });
    await waitFor(() => expect(supabase.auth.getUser).toHaveBeenCalledTimes(4));
    expect(
      vi
        .mocked(supabase.rpc)
        .mock.calls.filter((c) => c[0] === "registrar_acceso_panel"),
    ).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "registrar_acceso_panel",
      expect.objectContaining({ p_tipo: "acceso" }),
    );
  });
  it("una nueva carga desde otro dispositivo registra su propio acceso", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session },
      error: null,
    } as never);
    const first = await mount();
    first.unmount();
    await mount();
    expect(
      vi
        .mocked(supabase.rpc)
        .mock.calls.filter((c) => c[0] === "registrar_acceso_panel"),
    ).toHaveLength(2);
  });
});

it("un servidor aún sin la migración mantiene el login anterior hasta activar v2", async () => {
  vi.mocked(supabase.rpc).mockResolvedValue({
    data: null,
    error: { code: "PGRST202" },
  } as never);
  vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
    data: { user, session },
    error: null,
  } as never);
  const insert = vi.fn().mockResolvedValue({ error: null });
  vi.mocked(supabase.from).mockReturnValue({ insert } as never);
  const { result } = await mount();
  await act(async () => {
    expect(
      (await result.current.signIn("user@test.local", "password")).error,
    ).toBeNull();
  });
  expect(supabase.functions.invoke).not.toHaveBeenCalled();
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({ accion: "login", actor_user_id: user.id }),
  );
});
it("una restauración sin conexión no entra sin comprobar al usuario y registrar el acceso", async () => {
  vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
    data: { session },
    error: null,
  } as never);
  vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
    data: { user: null },
    error: { status: 503 },
  } as never);
  const { result } = await mount();
  expect(result.current.user).toBeNull();
});

it("un bloqueo remoto cierra la sesión abierta y desmonta el acceso", async () => {
  vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
    data: { session },
    error: null,
  } as never);
  const { result } = await mount();
  expect(result.current.user?.id).toBe(user.id);
  await act(async () => {
    state.remote?.({ new: { access_blocked: true } });
  });
  expect(result.current.user).toBeNull();
  expect(result.current.session).toBeNull();
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  // Una validación anterior o un SIGNED_IN tardío no reinstala al bloqueado.
  await act(async () => {
    state.callback?.("SIGNED_IN", session);
  });
  expect(result.current.user).toBeNull();
});

it("comprueba el bloqueo al recuperar el foco si se perdió Realtime", async () => {
  vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
    data: { session },
    error: null,
  } as never);
  const { result } = await mount();
  vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
    data: { user: null },
    error: { status: 403 },
  } as never);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(result.current.user).toBeNull();
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});

it("no cierra una sesión válida por un corte de red y elimina la suscripción al desmontar", async () => {
  vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
    data: { session },
    error: null,
  } as never);
  const hook = await mount();
  vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({
    data: { user: null },
    error: { status: 503 },
  } as never);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(hook.result.current.user?.id).toBe(user.id);
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
  hook.unmount();
  expect(supabase.removeChannel).toHaveBeenCalled();
});
