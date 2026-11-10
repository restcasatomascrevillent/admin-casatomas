// ============================================================================
//  procesar-logs-web / linear.ts — destino de los tickets
// ----------------------------------------------------------------------------
//  Dos destinos con la misma interfaz:
//    · real   → API GraphQL de Linear (https://api.linear.app/graphql),
//               cabecera `Authorization: <LINEAR_API_KEY>` (clave personal).
//    · prueba → tabla web_linear_prueba: guarda exactamente lo que se
//               mandaría a Linear. Es el «destino de pruebas» para verificar el
//               flujo completo (crear, comentar, reabrir) sin tocar Linear.
//
//  SIN DUPLICADOS aunque se reintente o haya dos procesos: el ticket se crea
//  con `id` = linear_uuid de la incidencia (IssueCreateInput.id admite un UUID
//  v4 propio). Si el primer intento llegó a crearlo pero la respuesta se
//  perdió (timeout), el reintento choca con ese id y aquí se recupera el
//  ticket existente con `issue(id)` en vez de crear otro.
//  Sin Deno ni imports remotos: se prueba con vitest y un fetch simulado.
// ============================================================================

export interface TicketLinear {
  id: string;
  identificador: string | null;
  url: string | null;
  estadoTipo: string | null; // triage | backlog | unstarted | started | completed | canceled | duplicate
  estadoNombre: string | null;
}

export interface DatosCrear {
  id: string; // linear_uuid
  equipoId: string | null;
  proyectoId: string | null;
  titulo: string;
  descripcion: string;
  prioridad: number; // 1 urgente, 2 alta, 3 normal, 4 baja
  etiquetas: string[];
  incidenciaId: number;
}

export interface DestinoTickets {
  tipo: "prueba" | "real";
  crear(d: DatosCrear): Promise<TicketLinear>;
  comentar(issueId: string, cuerpo: string, incidenciaId: number): Promise<void>;
  consultar(issueId: string): Promise<TicketLinear | null>;
  reabrir(issueId: string, estadoId: string | null, incidenciaId: number): Promise<void>;
}

export class ErrorLinear extends Error {
  constructor(message: string, readonly reintentable: boolean, readonly status: number | null = null) {
    super(message);
    this.name = "ErrorLinear";
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const LINEAR_API = "https://api.linear.app/graphql";

const CAMPOS_TICKET = "id identifier url state { name type }";

function aTicket(issue: Record<string, unknown> | null | undefined): TicketLinear | null {
  if (!issue || typeof issue.id !== "string") return null;
  const estado = (issue.state ?? null) as { name?: string; type?: string } | null;
  return {
    id: issue.id,
    identificador: typeof issue.identifier === "string" ? issue.identifier : null,
    url: typeof issue.url === "string" ? issue.url : null,
    estadoTipo: estado?.type ?? null,
    estadoNombre: estado?.name ?? null,
  };
}

const esDuplicado = (mensaje: string) => /already exists|duplicate|unique constraint|conflict|entity.*exist/i.test(mensaje);

export function crearDestinoLinear(opts: {
  apiKey: string;
  fetchFn?: FetchLike;
  url?: string;
  intentos?: number;
  esperar?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}): DestinoTickets {
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const url = opts.url ?? LINEAR_API;
  const intentos = Math.max(1, opts.intentos ?? 3);
  const esperar = opts.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let ultimo: ErrorLinear | null = null;
    for (let n = 1; n <= intentos; n++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: opts.apiKey },
          body: JSON.stringify({ query, variables }),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(t);
        ultimo = new ErrorLinear(`Linear sin respuesta: ${(e as Error)?.message ?? e}`, true);
        if (n < intentos) await esperar(Math.min(1000 * 2 ** (n - 1), 8000));
        continue;
      }
      clearTimeout(t);
      const texto = await res.text().catch(() => "");
      let cuerpo: { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> } = {};
      try {
        cuerpo = texto ? JSON.parse(texto) : {};
      } catch {
        // cuerpo no JSON: se trata por el código HTTP
      }
      const mensajes = (cuerpo.errors ?? []).map((e) => e.message ?? e.extensions?.code ?? "error").join("; ");
      if (res.status === 401 || res.status === 403) throw new ErrorLinear(`Linear rechaza la clave (${res.status})`, false, res.status);
      if (res.status === 429 || res.status >= 500 || /ratelimit|rate limit/i.test(mensajes)) {
        ultimo = new ErrorLinear(`Linear ${res.status}: ${mensajes || texto.slice(0, 200)}`, true, res.status);
        if (n < intentos) await esperar(Math.min(1000 * 2 ** (n - 1), 8000));
        continue;
      }
      if (!res.ok || mensajes) throw new ErrorLinear(`Linear ${res.status}: ${mensajes || texto.slice(0, 200)}`, false, res.status);
      return cuerpo.data as T;
    }
    throw ultimo ?? new ErrorLinear("Linear: error desconocido", true);
  }

  async function consultar(issueId: string): Promise<TicketLinear | null> {
    const d = await gql<{ issue?: Record<string, unknown> | null }>(`query($id: String!) { issue(id: $id) { ${CAMPOS_TICKET} } }`, { id: issueId });
    return aTicket(d?.issue ?? null);
  }

  return {
    tipo: "real",
    async crear(d) {
      if (!d.equipoId) throw new ErrorLinear("Falta el equipo de Linear (Configuración › Linear)", false);
      const input: Record<string, unknown> = {
        id: d.id,
        teamId: d.equipoId,
        title: d.titulo,
        description: d.descripcion,
        priority: d.prioridad,
      };
      if (d.proyectoId) input.projectId = d.proyectoId;
      if (d.etiquetas.length) input.labelIds = d.etiquetas;
      try {
        const r = await gql<{ issueCreate?: { success?: boolean; issue?: Record<string, unknown> } }>(
          `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${CAMPOS_TICKET} } } }`,
          { input },
        );
        const ticket = aTicket(r?.issueCreate?.issue);
        if (!r?.issueCreate?.success || !ticket) throw new ErrorLinear("Linear no confirmó la creación del ticket", true);
        return ticket;
      } catch (e) {
        // Un intento anterior ya lo creó (respuesta perdida): se recupera, no se duplica.
        if (e instanceof ErrorLinear && !e.reintentable && esDuplicado(e.message)) {
          const existente = await consultar(d.id);
          if (existente) return existente;
        }
        if (e instanceof ErrorLinear && e.reintentable) {
          const existente = await consultar(d.id).catch(() => null);
          if (existente) return existente;
        }
        throw e;
      }
    },
    async comentar(issueId, cuerpo) {
      const r = await gql<{ commentCreate?: { success?: boolean } }>(
        `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
        { input: { issueId, body: cuerpo } },
      );
      if (!r?.commentCreate?.success) throw new ErrorLinear("Linear no confirmó el comentario", true);
    },
    consultar,
    async reabrir(issueId, estadoId) {
      if (!estadoId) return; // sin estado configurado, solo se comenta
      const r = await gql<{ issueUpdate?: { success?: boolean } }>(
        `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
        { id: issueId, input: { stateId: estadoId } },
      );
      if (!r?.issueUpdate?.success) throw new ErrorLinear("Linear no confirmó la reapertura", true);
    },
  };
}

// ─── Destino de pruebas ─────────────────────────────────────────────────────
export interface RepoPrueba {
  buscarCreado(linearUuid: string): Promise<{ id: number } | null>;
  insertar(fila: {
    incidencia_id: number;
    operacion: "crear" | "comentar" | "reabrir" | "consultar";
    linear_uuid: string | null;
    titulo: string | null;
    cuerpo: string | null;
    prioridad: number | null;
    etiquetas: string[];
  }): Promise<{ id: number }>;
}

/** Destino de pruebas: mismo contrato, ids sintéticos «PRUEBA-n» y enlace al detalle del panel. */
export function crearDestinoPrueba(repo: RepoPrueba, urlPanel: string): DestinoTickets {
  const url = (incidenciaId: number) => `${urlPanel.replace(/\/+$/, "")}/super-admin/logs?incidencia=${incidenciaId}`;
  return {
    tipo: "prueba",
    async crear(d) {
      const previo = await repo.buscarCreado(d.id);
      const fila = previo ?? (await repo.insertar({
        incidencia_id: d.incidenciaId, operacion: "crear", linear_uuid: d.id, titulo: d.titulo,
        cuerpo: d.descripcion, prioridad: d.prioridad, etiquetas: d.etiquetas,
      }));
      return { id: d.id, identificador: `PRUEBA-${fila.id}`, url: url(d.incidenciaId), estadoTipo: "triage", estadoNombre: "Destino de pruebas" };
    },
    async comentar(issueId, cuerpo, incidenciaId) {
      await repo.insertar({ incidencia_id: incidenciaId, operacion: "comentar", linear_uuid: issueId, titulo: null, cuerpo, prioridad: null, etiquetas: [] });
    },
    async consultar(issueId) {
      return { id: issueId, identificador: null, url: null, estadoTipo: "triage", estadoNombre: "Destino de pruebas" };
    },
    async reabrir(issueId, _estado, incidenciaId) {
      await repo.insertar({ incidencia_id: incidenciaId, operacion: "reabrir", linear_uuid: issueId, titulo: null, cuerpo: null, prioridad: null, etiquetas: [] });
    },
  };
}

/** Prioridad de Linear según gravedad e impacto. */
export function prioridadLinear(gravedad: string, sesiones: number): number {
  if (gravedad === "critico") return 1;
  if (gravedad === "error") return sesiones >= 10 ? 2 : 3;
  return 4;
}
