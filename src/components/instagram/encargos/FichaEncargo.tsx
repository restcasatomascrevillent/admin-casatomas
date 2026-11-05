/**
 * Ficha de un encargo (cajón): pasos, la última versión entregada con
 * «Aprobar» y «Pedir cambios» (con el contador de rondas), versiones
 * anteriores, el resumen del pedido, las fotos y el hilo (mensajes e
 * historial). Los botones dependen del estado y de quién mira
 * (accionesDisponibles); la base de datos vuelve a comprobarlo todo.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, ExternalLink, Image as ImageIcon, Loader2, MessageSquare, PenLine, Play, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { fotoPreparable } from "@/lib/instagram";
import { ProgramarPiezaDialog } from "@/components/instagram/programar";
import { CLAVE_ENCARGOS, claveDetalle, leerPieza, llamarRpc, medidasFichero, mensajeErrorEncargo, subirFichero, urlCubo } from "./api";
import { generarAutomatico } from "./automatico";
import { useDetalleEncargo } from "./useEncargos";
import {
  accionesDisponibles,
  avisoMedidas,
  CLASE_ESTADO,
  fechaCorta,
  hoyMadrid,
  NOMBRE_ESTADO,
  NOMBRE_FORMATO,
  NOMBRE_MARCA,
  NOMBRE_MODO,
  PASOS,
  pasoDeEstado,
  problemaFicheroEntrega,
  referencia,
  rutasEntrega,
  textoEvento,
  textoRonda,
  type AdjuntoEncargo,
  type Encargo,
  type EntregaEncargo,
  type Roles,
} from "./logica";

type Panel = null | "cambios" | "rechazar" | "cancelar" | "aceptar" | "entregar";

interface Props {
  encargo: Encargo | null;
  roles: Roles;
  onCerrar: () => void;
  onEditar: (e: Encargo, adjuntos: AdjuntoEncargo[]) => void;
  /** Abre una pieza automática de imagen en «Crear» para retocarla. */
  onAbrirPieza?: (piezaId: string) => void;
}

/** Enlace para ver una foto del restaurante (Drive o carta). */
function enlaceFoto(a: AdjuntoEncargo): string | null {
  if (a.miniatura && /^https:\/\//.test(a.miniatura)) return a.miniatura;
  const o = fotoPreparable(a.foto_id);
  return o?.origen === "drive" ? `https://drive.google.com/file/d/${encodeURIComponent(o.id)}/view` : null;
}

function Medio({ entrega, pieza, encargo }: { entrega: EntregaEncargo; pieza: Awaited<ReturnType<typeof leerPieza>>; encargo: Encargo }) {
  const ver = pieza?.updated_at ?? entrega.created_at;
  const url = entrega.ruta
    ? urlCubo(entrega.cubo, entrega.ruta)
    : entrega.tipo_medio === "reel"
      ? urlCubo("instagram-video", pieza?.video_ruta, ver)
      : urlCubo("instagram", pieza?.imagen_ruta, ver);
  const portada = entrega.portada_ruta ? urlCubo(entrega.cubo, entrega.portada_ruta) : pieza?.portada_ruta ? urlCubo("instagram-video", pieza.portada_ruta, ver) : null;
  const proporcion = encargo.formato === "post" ? "aspect-[4/5]" : "aspect-[9/16]";
  if (!url) {
    return (
      <div className={cn("flex w-full items-center justify-center rounded-md bg-muted p-2 text-center text-xs text-muted-foreground", proporcion)}>
        {entrega.pieza_id ? "Abre la pieza en «Crear» para verla" : "Sin vista previa"}
      </div>
    );
  }
  return entrega.tipo_medio === "reel" ? (
    <video src={url} poster={portada ?? undefined} controls playsInline preload="metadata" className={cn("w-full rounded-md bg-black object-contain", proporcion)} aria-label={`Versión ${entrega.version}`} />
  ) : (
    <img src={url} alt={`Versión ${entrega.version} de ${encargo.titulo}`} className={cn("w-full rounded-md bg-muted object-cover", proporcion)} />
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export function FichaEncargo({ encargo, roles, onCerrar, onEditar, onAbrirPieza }: Props) {
  const qc = useQueryClient();
  const { data: detalle, isLoading } = useDetalleEncargo(encargo?.id ?? null);
  const { data: pieza } = useQuery({
    queryKey: ["instagram_encargos", "pieza", encargo?.pieza_id ?? ""],
    queryFn: () => leerPieza(encargo?.pieza_id as string),
    enabled: !!encargo?.pieza_id && roles.restaurante,
    refetchInterval: encargo?.estado === "en_curso" ? 10_000 : false,
  });
  const [panel, setPanel] = useState<Panel>(null);
  const [texto, setTexto] = useState("");
  const [fecha, setFecha] = useState("");
  const [comentario, setComentario] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [portada, setPortada] = useState<File | null>(null);
  const [textoEntrega, setTextoEntrega] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [programar, setProgramar] = useState(false);

  const acciones = encargo ? accionesDisponibles(encargo, roles) : [];
  const entregas = detalle?.entregas ?? [];
  const ultima = entregas[entregas.length - 1] ?? null;
  const hilo = useMemo(() => {
    const m = (detalle?.mensajes ?? []).map((x) => ({ tipo: "mensaje" as const, id: x.id, lado: x.lado, texto: x.texto, cuando: x.created_at }));
    const ev = (detalle?.eventos ?? [])
      .filter((x) => x.accion !== "comentar")
      .map((x) => ({ tipo: "evento" as const, id: x.id, lado: x.lado, texto: textoEvento(x), cuando: x.created_at }));
    return [...m, ...ev].sort((a, b) => a.cuando.localeCompare(b.cuando));
  }, [detalle]);

  if (!encargo) return null;
  const paso = pasoDeEstado(encargo.estado);

  const abrirPanel = (p: Panel) => {
    setTexto("");
    setArchivo(null);
    setPortada(null);
    setTextoEntrega(encargo.texto ?? "");
    if (p === "aceptar") {
      const hoy = hoyMadrid();
      const deseada = encargo.fecha_deseada ?? hoy;
      const menos2 = new Date(`${deseada}T12:00:00Z`);
      menos2.setUTCDate(menos2.getUTCDate() - 2);
      const candidata = [encargo.fecha_entrega_prevista ?? deseada, menos2.toISOString().slice(0, 10)].sort()[0];
      setFecha(candidata < hoy ? hoy : candidata);
    }
    setPanel(p);
  };

  async function ejecutar(clave: string, nombre: string, args: Record<string, unknown>, ok: string) {
    setOcupado(clave);
    try {
      const r = await llamarRpc(nombre, args);
      toast.success(ok);
      setPanel(null);
      await Promise.all([qc.invalidateQueries({ queryKey: CLAVE_ENCARGOS }), qc.invalidateQueries({ queryKey: claveDetalle(encargo!.id) })]);
      return r;
    } catch (e) {
      toast.error("No se pudo completar", { description: mensajeErrorEncargo(e) });
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function entregar() {
    if (!archivo || !encargo) return;
    const problema = problemaFicheroEntrega(archivo, encargo.formato);
    if (problema) {
      toast.error(problema);
      return;
    }
    if (portada && portada.type !== "image/jpeg" && !/\.jpe?g$/i.test(portada.name)) {
      toast.error("La portada tiene que ser un JPEG.");
      return;
    }
    setOcupado("entregar");
    try {
      const medidas = await medidasFichero(archivo);
      const aviso = avisoMedidas(encargo.formato, medidas.ancho, medidas.alto);
      if (aviso) toast.warning(aviso);
      const rutas = rutasEntrega(encargo, entregas.length + 1);
      await subirFichero(rutas.cubo, rutas.ruta, archivo, encargo.formato === "reel" ? "video/mp4" : "image/jpeg");
      if (portada && rutas.portada) await subirFichero(rutas.cubo, rutas.portada, portada, "image/jpeg");
      setOcupado(null);
      await ejecutar(
        "entregar",
        "instagram_encargo_entregar",
        {
          p_id: encargo.id,
          p_ruta: rutas.ruta,
          p_portada_ruta: portada ? rutas.portada : null,
          p_texto: textoEntrega || null,
          p_nota: texto || null,
          p_bytes: archivo.size,
          p_ancho: medidas.ancho,
          p_alto: medidas.alto,
          p_duracion_s: medidas.duracion,
        },
        `Versión ${entregas.length + 1} entregada`,
      );
    } catch (e) {
      toast.error("No se pudo subir la entrega", { description: mensajeErrorEncargo(e) });
      setOcupado(null);
    }
  }

  async function generar() {
    if (!encargo) return;
    setOcupado("generar");
    try {
      await generarAutomatico(qc, encargo, (detalle?.adjuntos ?? []).map((a) => ({ id: a.foto_id, nombre: a.nombre, miniatura: a.miniatura })));
      toast.success(encargo.formato === "reel" ? "Lo estamos montando: te avisamos cuando esté" : "Pieza generada");
      await qc.invalidateQueries({ queryKey: CLAVE_ENCARGOS });
    } catch (e) {
      toast.error("No se pudo generar la pieza", { description: mensajeErrorEncargo(e) });
    } finally {
      setOcupado(null);
    }
  }

  const girando = (c: string) => ocupado === c && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />;
  const siguienteRonda = encargo.rondas_cambios + 1;

  return (
    <Sheet open={!!encargo} onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" data-testid="ficha-encargo">
        <SheetHeader className="border-b p-4">
          <SheetDescription>
            {referencia(encargo.numero)} · {NOMBRE_FORMATO[encargo.formato]} · {NOMBRE_MARCA[encargo.marca]}
          </SheetDescription>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {encargo.titulo}
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", CLASE_ESTADO[encargo.estado])} data-testid="estado-encargo">
              {NOMBRE_ESTADO[encargo.estado]}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {paso >= 0 && (
            <ol className="flex gap-1 text-xs" aria-label="Estado del encargo">
              {PASOS.map((p, i) => (
                <li
                  key={p}
                  aria-current={i === paso ? "step" : undefined}
                  className={cn("flex-1 border-t-4 pt-1", i < paso ? "border-primary/50 text-muted-foreground" : i === paso ? "border-primary font-semibold" : "border-muted text-muted-foreground")}
                >
                  {p}
                </li>
              ))}
            </ol>
          )}

          {encargo.motivo && (encargo.estado === "rechazado" || encargo.estado === "cancelado") && (
            <p role="note" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-900">
              <b>{encargo.estado === "rechazado" ? "Oficiosos no puede hacerlo: " : "Cancelado: "}</b>
              {encargo.motivo}
              {encargo.estado === "rechazado" && roles.restaurante && " Puedes editarlo y volver a enviarlo."}
            </p>
          )}

          {ultima && (
            <section className="grid gap-3 rounded-md border p-3 sm:grid-cols-[12rem_1fr]" aria-label="Última versión" data-testid="ultima-version">
              <Medio entrega={ultima} pieza={pieza ?? null} encargo={encargo} />
              <div className="min-w-0 space-y-2 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {encargo.estado === "para_revisar" ? "Entrega para revisar" : "Última versión"}
                </span>
                <h3 className="font-semibold">
                  Versión {ultima.version} · {new Date(ultima.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </h3>
                {ultima.nota && <p>{ultima.nota}</p>}
                {(ultima.texto ?? pieza?.caption) && <p className="whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">{ultima.texto ?? pieza?.caption}</p>}
                {ultima.tipo_medio === "reel" && ultima.duracion_s && <p className="text-xs text-muted-foreground">{Number(ultima.duracion_s)} s</p>}
                <div className="flex flex-wrap gap-2">
                  {acciones.includes("aprobar") && (
                    <Button size="sm" onClick={() => void ejecutar("aprobar", "instagram_encargo_aprobar", { p_id: encargo.id }, "Aprobado: ya es una pieza que puedes probar, publicar o programar")} disabled={!!ocupado}>
                      {girando("aprobar") || <Check className="mr-1 h-4 w-4" aria-hidden="true" />}
                      Aprobar
                    </Button>
                  )}
                  {acciones.includes("pedir_cambios") && (
                    <Button size="sm" variant="outline" onClick={() => abrirPanel("cambios")} disabled={!!ocupado}>
                      Pedir cambios
                    </Button>
                  )}
                  {encargo.modo === "automatico" && encargo.formato !== "reel" && encargo.pieza_id && onAbrirPieza && roles.restaurante && encargo.estado === "para_revisar" && (
                    <Button size="sm" variant="ghost" onClick={() => onAbrirPieza(encargo.pieza_id!)}>
                      <PenLine className="mr-1 h-4 w-4" aria-hidden="true" />
                      Retocar en «Crear»
                    </Button>
                  )}
                </div>
                {encargo.modo === "oficiosos" && encargo.estado === "para_revisar" && (
                  <p className="text-xs text-muted-foreground" data-testid="contador-rondas">
                    Si pides cambios: {textoRonda(siguienteRonda, encargo.rondas_incluidas)}.
                  </p>
                )}
              </div>
            </section>
          )}

          {encargo.modo === "automatico" && encargo.estado === "en_curso" && (
            <p className="flex items-center gap-2 rounded-md bg-blue-50 p-2 text-sm text-blue-900" role="status">
              {encargo.pieza_id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {encargo.pieza_id
                ? pieza?.error
                  ? `No se pudo generar: ${pieza.error}`
                  : "Generando la pieza… pasará a «Para revisar» sola."
                : "La pieza aún no se ha generado."}
            </p>
          )}

          {/* Paneles de acción */}
          {panel === "cambios" && (
            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="enc-cambios">¿Qué cambiarías?</Label>
              <Textarea id="enc-cambios" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
              <p className={cn("text-xs", siguienteRonda > encargo.rondas_incluidas ? "text-amber-700" : "text-muted-foreground")}>{textoRonda(siguienteRonda, encargo.rondas_incluidas)}</p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Cancelar</Button>
                <Button size="sm" disabled={!texto.trim() || !!ocupado} onClick={() => void ejecutar("cambios", "instagram_encargo_pedir_cambios", { p_id: encargo.id, p_comentario: texto }, "Cambios pedidos a Oficiosos")}>
                  {girando("cambios")}Pedir cambios
                </Button>
              </div>
            </div>
          )}
          {(panel === "rechazar" || panel === "cancelar") && (
            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="enc-motivo">{panel === "rechazar" ? "¿Por qué no se puede hacer? (por ejemplo, falta material)" : "Motivo de la cancelación"}</Label>
              <Textarea id="enc-motivo" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Volver</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!texto.trim() || !!ocupado}
                  onClick={() =>
                    void ejecutar(panel, panel === "rechazar" ? "instagram_encargo_rechazar" : "instagram_encargo_cancelar", panel === "rechazar" ? { p_id: encargo.id, p_motivo: texto } : { p_id: encargo.id, p_motivo: texto }, panel === "rechazar" ? "Encargo rechazado" : "Encargo cancelado")
                  }
                >
                  {girando(panel ?? "")}
                  {panel === "rechazar" ? "Rechazar" : "Cancelar el encargo"}
                </Button>
              </div>
            </div>
          )}
          {panel === "aceptar" && (
            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="enc-entrega">Fecha de entrega comprometida</Label>
              <Input id="enc-entrega" type="date" min={hoyMadrid()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              <Label htmlFor="enc-acepta-com">Comentario (opcional)</Label>
              <Textarea id="enc-acepta-com" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Volver</Button>
                <Button size="sm" disabled={!fecha || !!ocupado} onClick={() => void ejecutar("aceptar", "instagram_encargo_aceptar", { p_id: encargo.id, p_fecha_entrega: fecha, p_comentario: texto || null }, "Encargo aceptado")}>
                  {girando("aceptar")}Aceptar
                </Button>
              </div>
            </div>
          )}
          {panel === "entregar" && (
            <div className="space-y-2 rounded-md border p-3" data-testid="panel-entregar">
              <Label htmlFor="enc-fichero">{encargo.formato === "reel" ? "Vídeo MP4 (9:16, 3-90 s, ≤ 50 MB)" : "Imagen JPEG (≤ 8 MB)"}</Label>
              <Input id="enc-fichero" type="file" accept={encargo.formato === "reel" ? "video/mp4" : "image/jpeg"} onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
              {encargo.formato === "reel" && (
                <>
                  <Label htmlFor="enc-portada">Portada JPEG (opcional)</Label>
                  <Input id="enc-portada" type="file" accept="image/jpeg" onChange={(e) => setPortada(e.target.files?.[0] ?? null)} />
                </>
              )}
              <Label htmlFor="enc-texto-entrega">Texto propuesto para la publicación</Label>
              <Textarea id="enc-texto-entrega" rows={2} maxLength={2200} value={textoEntrega} onChange={(e) => setTextoEntrega(e.target.value)} />
              <Label htmlFor="enc-nota">Nota para el restaurante</Label>
              <Textarea id="enc-nota" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>Volver</Button>
                <Button size="sm" disabled={!archivo || !!ocupado} onClick={() => void entregar()}>
                  {girando("entregar") || <Upload className="mr-1 h-4 w-4" aria-hidden="true" />}
                  Entregar versión {entregas.length + 1}
                </Button>
              </div>
            </div>
          )}

          {entregas.length > 1 && (
            <details className="rounded-md border p-2 text-sm">
              <summary className="cursor-pointer font-medium">Versiones anteriores ({entregas.length - 1})</summary>
              <ul className="mt-2 space-y-1">
                {entregas.slice(0, -1).reverse().map((v) => {
                  const url = v.ruta ? urlCubo(v.cubo, v.ruta) : null;
                  return (
                    <li key={v.id} className="flex items-center gap-2">
                      <span>Versión {v.version}</span>
                      <span className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleDateString("es-ES")}</span>
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs underline">
                          Ver <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <Fila etiqueta="Qué es">
              {NOMBRE_FORMATO[encargo.formato]} para {NOMBRE_MARCA[encargo.marca]}
            </Fila>
            <Fila etiqueta="Para cuándo">{fechaCorta(encargo.fecha_deseada)}</Fila>
            <Fila etiqueta="Quién lo hace">{NOMBRE_MODO[encargo.modo]}</Fila>
            {encargo.fecha_entrega && <Fila etiqueta="Entrega">{fechaCorta(encargo.fecha_entrega)} (comprometida)</Fila>}
            {!encargo.fecha_entrega && encargo.fecha_entrega_prevista && <Fila etiqueta="Entrega prevista">{fechaCorta(encargo.fecha_entrega_prevista)}</Fila>}
            {encargo.modo === "oficiosos" && (
              <Fila etiqueta="Rondas">
                {encargo.rondas_cambios} de {encargo.rondas_incluidas} incluidas
              </Fila>
            )}
            {(encargo.estilo || encargo.plantilla || encargo.base_reel) && (
              <Fila etiqueta="Estilo">{encargo.estilo || encargo.plantilla || (encargo.base_reel ? `Reel base «${encargo.base_reel}»` : "")}</Fila>
            )}
            {encargo.idea && <Fila etiqueta="Idea">{encargo.idea}</Fila>}
            {encargo.texto && <Fila etiqueta="Texto">{encargo.texto}</Fila>}
            {(detalle?.adjuntos.length ?? 0) > 0 && (
              <Fila etiqueta="Fotos">
                <ul className="flex flex-wrap gap-1.5">
                  {detalle!.adjuntos.map((a) => {
                    const href = enlaceFoto(a);
                    const contenido = a.miniatura ? (
                      <img src={a.miniatura} alt={a.nombre ?? "Foto"} className="h-14 w-14 rounded object-cover" />
                    ) : (
                      <span className="flex h-14 max-w-[9rem] items-center gap-1 rounded border px-2 text-xs">
                        <ImageIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{a.nombre || a.foto_id}</span>
                      </span>
                    );
                    return <li key={a.id}>{href ? <a href={href} target="_blank" rel="noreferrer" title={a.nombre ?? a.foto_id}>{contenido}</a> : contenido}</li>;
                  })}
                </ul>
              </Fila>
            )}
          </dl>

          <section aria-label="Comentarios" className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Comentarios</span>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Cargando" />}
            <ol className="space-y-2" data-testid="hilo-encargo">
              {hilo.map((h) =>
                h.tipo === "mensaje" ? (
                  <li key={h.id} className={cn("max-w-[85%] rounded-lg p-2 text-sm", h.lado === "agencia" ? "bg-blue-50" : "ml-auto bg-muted")}>
                    <div className="mb-0.5 text-xs text-muted-foreground">
                      <b>{h.lado === "agencia" ? "Oficiosos" : "Restaurante"}</b> · {new Date(h.cuando).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <p className="whitespace-pre-wrap break-words">{h.texto}</p>
                  </li>
                ) : (
                  <li key={h.id} className="text-center text-xs text-muted-foreground">
                    {h.texto} · {new Date(h.cuando).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </li>
                ),
              )}
            </ol>
            {acciones.includes("comentar") && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!comentario.trim()) return;
                  void ejecutar("comentar", "instagram_encargo_comentar", { p_id: encargo.id, p_texto: comentario, p_lado: roles.restaurante ? "restaurante" : "agencia" }, "Comentario enviado").then((r) => r && setComentario(""));
                }}
              >
                <Input value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Escribe un comentario" aria-label="Escribe un comentario" />
                <Button type="submit" size="icon" aria-label="Enviar comentario" disabled={!comentario.trim() || !!ocupado}>
                  {ocupado === "comentar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                </Button>
              </form>
            )}
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t p-3" data-testid="acciones-encargo">
          {acciones.includes("cancelar") && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-destructive"
              disabled={!!ocupado}
              onClick={() =>
                encargo.estado === "borrador"
                  ? void ejecutar("cancelar", "instagram_encargo_cancelar", { p_id: encargo.id, p_motivo: null }, "Borrador eliminado").then((r) => r && onCerrar())
                  : abrirPanel("cancelar")
              }
            >
              <X className="mr-1 h-4 w-4" aria-hidden="true" />
              {encargo.estado === "borrador" ? "Eliminar borrador" : "Cancelar encargo"}
            </Button>
          )}
          {acciones.includes("editar") && (
            <Button variant="outline" size="sm" onClick={() => onEditar(encargo, detalle?.adjuntos ?? [])}>
              <PenLine className="mr-1 h-4 w-4" aria-hidden="true" />
              Editar
            </Button>
          )}
          {acciones.includes("enviar") && (
            <Button size="sm" disabled={!!ocupado} onClick={() => void ejecutar("enviar", "instagram_encargo_enviar", { p_id: encargo.id }, "Encargo enviado")}>
              {girando("enviar") || <Send className="mr-1 h-4 w-4" aria-hidden="true" />}
              Enviar
            </Button>
          )}
          {acciones.includes("generar") && (
            <Button size="sm" disabled={!!ocupado} onClick={() => void generar()}>
              {girando("generar") || <Play className="mr-1 h-4 w-4" aria-hidden="true" />}
              Generar ahora
            </Button>
          )}
          {acciones.includes("rechazar") && (
            <Button variant="outline" size="sm" onClick={() => abrirPanel("rechazar")} disabled={!!ocupado}>
              Rechazar
            </Button>
          )}
          {acciones.includes("aceptar") && (
            <Button size="sm" onClick={() => abrirPanel("aceptar")} disabled={!!ocupado}>
              <Check className="mr-1 h-4 w-4" aria-hidden="true" />
              Aceptar
            </Button>
          )}
          {acciones.includes("empezar") && (
            <Button variant="outline" size="sm" disabled={!!ocupado} onClick={() => void ejecutar("empezar", "instagram_encargo_empezar", { p_id: encargo.id }, "Marcado como en curso")}>
              {girando("empezar")}Empezar
            </Button>
          )}
          {acciones.includes("entregar") && (
            <Button size="sm" onClick={() => abrirPanel("entregar")} disabled={!!ocupado}>
              <Upload className="mr-1 h-4 w-4" aria-hidden="true" />
              Entregar versión
            </Button>
          )}
          {acciones.includes("programar") && (
            <Button size="sm" onClick={() => setProgramar(true)}>
              <CalendarClock className="mr-1 h-4 w-4" aria-hidden="true" />
              Programar en la fecha pedida
            </Button>
          )}
        </div>

        {encargo.pieza_id && (
          <ProgramarPiezaDialog
            piezaId={programar ? encargo.pieza_id : null}
            open={programar}
            onOpenChange={setProgramar}
            inicial={encargo.fecha_deseada ? new Date(`${encargo.fecha_deseada}T13:00:00`) : null}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
