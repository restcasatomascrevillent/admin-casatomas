import { AsyncLocalStorage } from "node:async_hooks";

type Actor = { id: string; email?: string | null };
type Contexto = { fuente: string; peticionId: string; actor: Actor | null; userAgent: string; deviceId: string; ip: string };
const contexto = new AsyncLocalStorage<Contexto>();

// Conserva las firmas genéricas de las versiones de supabase-js usadas por
// las funciones. El contexto nunca se toma de un UUID enviado por el cliente.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fabrica = (...args: any[]) => any;
type Opciones = { global?: { headers?: Record<string, string>; fetch?: typeof fetch }; [key: string]: unknown };

function env(nombre: string): string {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } })
    .Deno?.env.get(nombre) ?? "";
}

/** Clientes globales y tareas en segundo plano leen el contexto de SU petición. */
export function clienteConAuditoria<T extends Fabrica>(fabrica: T, fuente: string): T {
  return ((url: string, key: string, opciones: Opciones = {}) => {
    const global = opciones.global ?? {};
    const transporte: typeof fetch = global.fetch ?? fetch;
    return fabrica(url, key, {
      ...opciones,
      global: {
        ...global,
        headers: { ...global.headers, "x-audit-source": fuente },
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(input instanceof Request ? input.headers : undefined);
          new Headers(init?.headers).forEach((valor, nombre) => headers.set(nombre, valor));
          const actual = contexto.getStore();
          headers.set("x-audit-source", actual?.fuente ?? fuente);
          if (actual) {
            headers.set("x-audit-request-id", actual.peticionId);
            headers.set("x-audit-user-agent", actual.userAgent);
            headers.set("x-audit-device-id", actual.deviceId);
            headers.set("x-audit-ip", actual.ip);
            // Un contexto sin usuario NO hereda la identidad de otra llamada.
            headers.delete("x-audit-actor-id");
            headers.delete("x-audit-actor-email");
            if (actual.actor) {
              headers.set("x-audit-actor-id", actual.actor.id);
              headers.set("x-audit-actor-email", actual.actor.email ?? "");
            }
          }
          return transporte(input, { ...init, headers });
        },
      },
    });
  }) as T;
}

const SIN_EVENTO_PROPIO = new Set([
  "admin-create-user", "admin-delete-user", "admin-set-super-admin", "admin-update-user-password",
  "list-users", "leer-metricas", "registrar-metrica", "vapi-analytics", "sync-trafico-web",
]);

const ADMITE_INTEGRACION = new Set([
  "chat-web", "newsletter-baja", "resend-webhook", "reservas-web", "emails-reserva",
  "newsletter-sync-resend", "sync-trafico-web", "ocr-trabajo", "clasificar-productos", "traducir-contenido",
]);

/** La autenticación y autorización de negocio siguen en cada handler. */
export function conAuditoriaDePeticion(
  fuente: string,
  fabrica: Fabrica,
  handler: (req: Request) => Response | Promise<Response>,
  resolverActor?: (token: string) => Promise<Actor | null>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return handler(req);
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    let actor: Actor | null = null;
    if (token && token !== env("SUPABASE_SERVICE_ROLE_KEY") && token !== env("SUPABASE_ANON_KEY") && !token.startsWith("sb_publishable_")) {
      try {
        if (resolverActor) actor = await resolverActor(token);
        else {
          const cliente = fabrica(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await cliente.auth.getUser(token);
          if (!error) actor = data?.user ?? null;
        }
      } catch (error) {
        console.error("No se pudo verificar el autor de la petición:", error);
        return new Response(JSON.stringify({ success: false, error: "No se pudo verificar tu identidad. La acción no se ha ejecutado." }), {
          status: 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      // Un JWT de usuario inválido o no verificable nunca se degrada a una
      // identidad genérica de proceso con la clave de servicio del handler.
      if (!actor?.id) {
        return new Response(JSON.stringify({ success: false, error: "No se pudo verificar tu identidad. La acción no se ha ejecutado." }), {
          status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }
    if (!actor && !(token && token === env("SUPABASE_SERVICE_ROLE_KEY")) && !ADMITE_INTEGRACION.has(fuente)) {
      return new Response(JSON.stringify({ success: false, error: "Se requiere un usuario autenticado para ejecutar esta acción." }), {
        status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    const info = req.headers.get("x-client-info")?.split("/") ?? [];
    const actual: Contexto = { fuente, actor, peticionId: crypto.randomUUID(),
      userAgent: req.headers.get("user-agent")?.slice(0, 1024) ?? "",
      deviceId: info[0] === "adminpanel" ? (info[1] ?? "").slice(0, 128) : "",
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 128) ?? "",
    };
    return contexto.run(actual, async () => {
      let response: Response;
      try { response = await handler(req); }
      catch (error) {
        console.error(`Error ejecutando ${fuente}:`, error);
        response = new Response(JSON.stringify({ success: false, error: "Error interno del servidor" }), {
          status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      // Efectos externos (envíos, sincronizaciones, OCR, publicación...) también
      // tienen un evento propio. Las mutaciones SQL se registran atómicamente
      // por trigger. No se guarda el cuerpo de la petición ni de la respuesta.
      if (actor && req.method !== "OPTIONS" && (!SIN_EVENTO_PROPIO.has(fuente) || !response.ok)) {
        let fallo = !response.ok;
        if (response.headers.get("Content-Type")?.includes("application/json")) {
          const cuerpo = await response.clone().json().catch(() => null);
          fallo ||= cuerpo?.success === false || cuerpo?.ok === false || !!cuerpo?.error;
        }
        const cliente = clienteConAuditoria(fabrica, fuente)(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
        const { error } = await cliente.rpc("registrar_accion_auditoria_panel", {
          p_operacion: fuente + new URL(req.url).pathname.split(fuente).slice(1).join(fuente),
          p_detalles: { resultado: fallo ? "fallida" : "completada", codigo_http: response.status },
        });
        if (error) {
          console.error("No se pudo registrar la acción del panel:", error);
          const headers = new Headers(response.headers);
          headers.set("Content-Type", "application/json");
          return new Response(JSON.stringify({ success: false, error: "La acción terminó, pero no se pudo verificar su registro de auditoría. Revisa el resultado antes de repetirla." }), {
            status: 500, headers,
          });
        }
      }
      return response;
    });
  };
}
