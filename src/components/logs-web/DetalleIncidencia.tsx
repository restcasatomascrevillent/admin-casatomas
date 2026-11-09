import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import {
  useCambiarIncidencia,
  useContextoEvento,
  useEnviosPrueba,
  useIncidencia,
  useOcurrencias,
  usePedirTicket,
  type EstadoIncidencia,
  type IncidenciaWeb,
} from "@/hooks/useLogsWeb";
import { fmtFechaHora, NOMBRE_ESTADO, NOMBRE_GRAVEDAD, NOMBRE_LINEAR, NOMBRE_TIPO } from "./calculos";
import { LineaTiempo } from "./LineaTiempo";
import { Paginacion } from "./Controles";

function Ticket({ i }: { i: IncidenciaWeb }) {
  const pedir = usePedirTicket();
  const envios = useEnviosPrueba(i.linear_destino === "prueba" ? i.id : null);
  const [verEnvio, setVerEnvio] = useState(false);
  return (
    <section className="space-y-2 rounded-md border p-3" data-testid="ticket-incidencia">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Ticket</h3>
        <Badge variant={i.linear_estado === "error" ? "destructive" : "outline"}>{NOMBRE_LINEAR[i.linear_estado] ?? i.linear_estado}</Badge>
        {i.linear_destino === "prueba" && <Badge variant="outline" className="border-amber-500/60 text-amber-700">destino de pruebas</Badge>}
        {i.linear_identificador && (
          i.linear_url && i.linear_destino === "real" ? (
            <a href={i.linear_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
              {i.linear_identificador} <ExternalLink className="h-3 w-3" />
            </a>
          ) : <span className="text-sm">{i.linear_identificador}</span>
        )}
        {i.linear_estado_remoto && <span className="text-xs text-muted-foreground">estado en Linear: {i.linear_estado_remoto}</span>}
      </div>
      {i.motivo_ticket && <p className="text-xs text-muted-foreground">{i.motivo_ticket}</p>}
      {i.linear_ultimo_error && (
        <p className="text-xs text-destructive">
          Último fallo: {i.linear_ultimo_error}. {i.linear_proximo_intento ? `Próximo intento: ${fmtFechaHora(i.linear_proximo_intento)}.` : ""} El trabajo no se pierde: se reintenta sin duplicar el ticket.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(i.linear_estado === "sin_ticket" || i.linear_estado === "no_aplica" || (i.linear_estado === "creado" && i.linear_destino === "prueba")) && (
          <Button variant="outline" className="h-11 gap-2" disabled={pedir.isPending}
            onClick={() => pedir.mutate(i.id, { onSuccess: () => toast.success("Ticket pedido: se crea en la próxima pasada (máx. 5 min) o con «Procesar ahora»."), onError: (e) => toast.error(e.message) })}>
            <Send className="h-4 w-4" /> {i.linear_estado === "creado" ? "Reenviar al destino actual" : "Pedir ticket"}
          </Button>
        )}
        {i.linear_destino === "prueba" && (envios.data?.length ?? 0) > 0 && (
          <Button variant="ghost" className="h-11" onClick={() => setVerEnvio((v) => !v)}>{verEnvio ? "Ocultar" : "Ver"} lo enviado al destino de pruebas</Button>
        )}
      </div>
      {verEnvio && envios.data?.map((e) => (
        <details key={e.id} className="rounded bg-muted/50 p-2 text-xs" open={e.operacion === "crear"}>
          <summary>{e.operacion} · {fmtFechaHora(e.creado_en)}{e.titulo ? ` · ${e.titulo}` : ""}</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words">{e.cuerpo}</pre>
        </details>
      ))}
    </section>
  );
}

function Analisis({ i }: { i: IncidenciaWeb }) {
  const a = i.analisis_ia;
  if (!a) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin análisis de IA{i.analisis_ia_error ? ` (último intento: ${i.analisis_ia_error})` : ""}. Se hace antes de crear el ticket, sobre la incidencia agrupada.
      </p>
    );
  }
  return (
    <section className="space-y-2 text-sm" data-testid="analisis-ia">
      <h3 className="text-sm font-semibold">Diagnóstico</h3>
      {a.impacto && <p><span className="text-muted-foreground">Impacto (IA):</span> {a.impacto}</p>}
      {a.hechos_observados.length > 0 && (
        <div><p className="text-xs font-medium">Hechos</p><ul className="list-disc pl-5">{a.hechos_observados.map((h) => <li key={h}>{h}</li>)}</ul></div>
      )}
      <div>
        <p className="text-xs font-medium">Hipótesis (IA · sin verificar)</p>
        <ul className="list-disc pl-5">{a.hipotesis.map((h) => <li key={h.texto}><Badge variant="outline" className="mr-1 text-[10px]">{h.confianza}</Badge>{h.texto}</li>)}</ul>
      </div>
      {a.propuesta.length > 0 && <div><p className="text-xs font-medium">Propuesta (no verificada)</p><ul className="list-disc pl-5">{a.propuesta.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {a.validacion.length > 0 && <div><p className="text-xs font-medium">Cómo validar</p><ul className="list-disc pl-5">{a.validacion.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {a.falta_contexto.length > 0 && <div><p className="text-xs font-medium">Falta contexto</p><ul className="list-disc pl-5">{a.falta_contexto.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      <p className="text-xs text-muted-foreground">{a.modelo ? `Modelo ${a.modelo} · ` : ""}{i.analisis_ia_en ? fmtFechaHora(i.analisis_ia_en) : ""}</p>
    </section>
  );
}

interface DetalleIncidenciaProps {
  id: number | null;
  onCerrar: () => void;
  onAbrirSesion: (id: string) => void;
}

/** Una incidencia: cifras, ticket, diagnóstico, evidencias, ocurrencias y el contexto antes/después de cada una. */
export function DetalleIncidencia({ id, onCerrar, onAbrirSesion }: DetalleIncidenciaProps) {
  const q = useIncidencia(id);
  const [pagina, setPagina] = useState(0);
  const ocurrencias = useOcurrencias(id, pagina);
  const [eventoContexto, setEventoContexto] = useState<number | null>(null);
  const contexto = useContextoEvento(eventoContexto);
  const cambiar = useCambiarIncidencia();
  const [nota, setNota] = useState("");
  const i = q.data;

  useEffect(() => {
    setPagina(0);
    setEventoContexto(null);
  }, [id]);
  useEffect(() => setNota(i?.nota ?? ""), [i?.id, i?.nota]);
  // Por defecto, el contexto de la ocurrencia más reciente con sesión.
  useEffect(() => {
    if (eventoContexto === null && ocurrencias.data?.filas.length) {
      // Preferimos una con consentimiento: la de un navegador sin él solo tiene su propio error (id efímero).
      const conSesion = ocurrencias.data.filas.find((e) => e.sesion_id && e.consentimiento) ?? ocurrencias.data.filas.find((e) => e.sesion_id);
      if (conSesion) setEventoContexto(conSesion.id);
    }
  }, [ocurrencias.data, eventoContexto]);

  const cambiarEstado = (estado: EstadoIncidencia) =>
    cambiar.mutate({ id: i!.id, estado }, { onSuccess: () => toast.success(`Incidencia ${NOMBRE_ESTADO[estado].toLowerCase()}`), onError: (e) => toast.error(e.message) });

  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent side="right" className="w-full max-w-none sm:max-w-3xl" data-testid="detalle-incidencia">
        <SheetHeader>
          <SheetTitle className="pr-8">{i ? `#${i.id} · ${i.titulo}` : "Incidencia"}</SheetTitle>
          <SheetDescription>
            {i ? `${NOMBRE_TIPO[i.tipo] ?? i.tipo} · ${i.fuente} · ${i.entorno} · huella ${i.huella.slice(0, 12)}…` : ""}
          </SheetDescription>
        </SheetHeader>
        {q.isError ? (
          <EstadoErrorCarga titulo="la incidencia" error={q.error} onReintentar={() => q.refetch()} />
        ) : !i ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={i.gravedad === "critico" || i.gravedad === "error" ? "destructive" : "outline"}>{NOMBRE_GRAVEDAD[i.gravedad]}</Badge>
              <Badge variant="outline">{NOMBRE_ESTADO[i.estado]}</Badge>
              {i.reabierta_veces > 0 && <Badge variant="outline">reabierta {i.reabierta_veces}×</Badge>}
              <div className="ml-auto flex flex-wrap gap-2">
                {i.estado !== "resuelta" && <Button variant="outline" className="h-11" onClick={() => cambiarEstado("resuelta")} disabled={cambiar.isPending}>Marcar resuelta</Button>}
                {i.estado !== "ignorada" && <Button variant="ghost" className="h-11" onClick={() => cambiarEstado("ignorada")} disabled={cambiar.isPending}>Ignorar</Button>}
                {(i.estado === "resuelta" || i.estado === "ignorada") && <Button variant="outline" className="h-11" onClick={() => cambiarEstado("abierta")} disabled={cambiar.isPending}>Reabrir</Button>}
              </div>
            </div>
            <TiraCifras
              cifras={[
                { etiqueta: "Ocurrencias", valor: i.ocurrencias, detalle: `${i.ocurrencias_24h} en 24 h` },
                { etiqueta: "Sesiones afectadas", valor: i.sesiones_afectadas, detalle: "distintas, con o sin consentimiento" },
                { etiqueta: "Primera vez", valor: fmtFechaHora(i.primera_vez) },
                { etiqueta: "Última vez", valor: fmtFechaHora(i.ultima_vez) },
                { etiqueta: "Versión", valor: i.version_ultima ?? "—", detalle: i.version_primera && i.version_primera !== i.version_ultima ? `desde ${i.version_primera}` : undefined },
              ]}
            />
            {i.rutas.length > 0 && <p className="text-xs text-muted-foreground">Páginas: {i.rutas.map((r) => `${r.ruta} (${r.n})`).join(" · ")}</p>}
            <Ticket i={i} />
            <Analisis i={i} />
            <section>
              <h3 className="mb-1 text-sm font-semibold">Evidencias (depuradas)</h3>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-xs">{[i.mensaje, i.pila].filter(Boolean).join("\n\n") || "(sin mensaje)"}</pre>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Ocurrencias</h3>
              <ul className="space-y-1 text-sm">
                {ocurrencias.data?.filas.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums text-xs">{fmtFechaHora(e.ocurrido_en)}</span>
                    <span className="text-xs text-muted-foreground">{e.ruta ?? ""} · {e.navegador ?? "?"} {e.so ?? ""} · v{e.version ?? "?"}</span>
                    {e.sesion_id ? (
                      <>
                        <Button variant={eventoContexto === e.id ? "secondary" : "ghost"} className="h-9 px-2 text-xs" onClick={() => setEventoContexto(e.id)}>contexto</Button>
                        <Button variant="ghost" className="h-9 px-2 text-xs" onClick={() => onAbrirSesion(e.sesion_id!)}>sesión completa</Button>
                      </>
                    ) : <span className="text-xs italic text-muted-foreground">sin sesión (sin consentimiento o servidor)</span>}
                  </li>
                ))}
              </ul>
              <Paginacion pagina={pagina} tam={10} total={ocurrencias.data?.total ?? 0} onCambio={setPagina} cargando={ocurrencias.isFetching} />
            </section>
            <section className="space-y-2" data-testid="contexto-error">
              <h3 className="text-sm font-semibold">Antes y después del fallo</h3>
              {eventoContexto === null ? (
                <p className="text-xs text-muted-foreground">Ninguna ocurrencia tiene sesión: no hay recorrido disponible (falta contexto).</p>
              ) : contexto.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LineaTiempo eventos={contexto.data ?? []} resaltado={eventoContexto} />
              )}
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Nota interna</h3>
              <Textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={2000} rows={2} aria-label="Nota interna" />
              <Button variant="outline" className="h-11" disabled={cambiar.isPending || nota === (i.nota ?? "")}
                onClick={() => cambiar.mutate({ id: i.id, nota: nota || null }, { onSuccess: () => toast.success("Nota guardada"), onError: (e) => toast.error(e.message) })}>
                Guardar nota
              </Button>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
