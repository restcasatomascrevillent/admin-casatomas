/**
 * Instagram › Campañas (fase 2 de la propuesta, pantalla «Campañas» de la
 * maqueta). A la izquierda, las propuestas de la IA y el campo «¿Qué quieres
 * empujar?»; a la derecha, la ficha de la campaña elegida: objetivo, público,
 * mensaje, línea de tiempo con sus fases y las piezas (fecha, formato,
 * plantilla, plato y si falta foto), cada una con su casilla.
 *
 * «Aceptar y llevar al calendario» crea las piezas marcadas como BORRADORES
 * con fecha prevista (RPC instagram_aceptar_campana). NUNCA programa ni
 * publica: eso sigue siendo el clic de siempre en «Crear».
 *
 *   <CampanasInstagram onAbrirBorrador={(piezaId) => …} onVerCalendario={() => …} />
 *
 * Ocupa el alto que le dé la página (sin scroll de página): cada columna hace
 * scroll por dentro desde `lg`; por debajo se apilan.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck2, Check, Loader2, Pencil, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { obtenerPlantilla, type MarcaId } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import { hoyMadrid, sumarDias } from "@/components/instagram/programar/logica";
import { InsigniaEstado } from "@/components/instagram/InsigniaEstado";
import { MiniaturaFoto } from "@/components/instagram/MiniaturaFoto";
import { FormularioEncargo } from "@/components/instagram/encargos/FormularioEncargo";
import { useAjustesEncargos } from "@/components/instagram/encargos/useEncargos";
import type { DatosFormulario } from "@/components/instagram/encargos/logica";
import "@/components/instagram/titular-studio.css";
import {
  aceptarCampana,
  borradoresDeCampana,
  CLAVE_CAMPANAS,
  descartarCampana,
  ErrorIA,
  listarCampanas,
  proponerCampana,
  type CampanaInstagram,
  type PeticionCampana,
  type PiezaCampanaIA,
} from "./api";
import { diasEntre, peticionDeNuevo, piezasPorFase, posicionEnRiel, textoDia, textoDuracion, textoRango } from "./logica";

const NOMBRE_MARCA: Record<string, string> = { "casa-tomas": "Casa Tomás", touza: "Touza" };
const MAX_OBJETIVO = 500;

export interface CampanasInstagramProps {
  /** Marca con la que arranca el formulario (por defecto Casa Tomás). */
  marcaInicial?: MarcaId;
  /** Si se pasa, cada borrador de una campaña aceptada tiene «Abrir en Crear». */
  onAbrirBorrador?: (piezaId: string) => void;
  /** Si se pasa, tras aceptar sale «Ver en el calendario». */
  onVerCalendario?: () => void;
  /** Marca de la barra de pestañas: filtra la lista y es la marca con la que se pide la siguiente. */
  marca?: MarcaId | "todas";
  /** Tras pedir una foto a Oficiosos: el id del encargo (para abrir su ficha). */
  onAbrirEncargo?: (encargoId: string) => void;
  className?: string;
}

/** Datos de partida del encargo «Pedir foto a Oficiosos» para una pieza de campaña sin foto. */
export function encargoDeFoto(c: Pick<CampanaInstagram, "marca" | "titulo">, p: PiezaCampanaIA, hoy: string): Partial<DatosFormulario> {
  const que = p.plato?.nombre ?? (p.titular || p.gancho || "la pieza");
  const antes = sumarDias(p.fecha, -2);
  return {
    marca: c.marca,
    modo: "oficiosos",
    formato: p.formato === "story" ? "story" : "post",
    titulo: `Foto: ${que}`.slice(0, 120),
    idea: [`Foto para la campaña «${c.titulo}» (${textoDia(p.fecha)}, ${p.hora}).`, p.titular && `Titular: «${p.titular}».`, p.encargoSugerido, p.porQue]
      .filter(Boolean)
      .join(" "),
    texto: p.caption ?? "",
    fecha_deseada: antes >= hoy ? antes : hoy,
  };
}

function textoError(e: unknown): string {
  return e instanceof Error ? e.message : "Error desconocido";
}

function EstadoCampana({ estado }: { estado: CampanaInstagram["estado"] }) {
  return <InsigniaEstado dominio="campana" estado={estado} />;
}

/** Línea de tiempo: fases proporcionales a sus días y un punto por pieza. */
function LineaTiempo({ c, marcadas }: { c: CampanaInstagram; marcadas: Set<number> }) {
  const { desde, hasta, fases, piezas } = c.propuesta;
  const tramos = fases.length ? fases : [{ nombre: "Campaña", desde, hasta }];
  return (
    <div aria-label="Línea de tiempo de la campaña" role="group" className="space-y-1">
      <div className="grid gap-1" style={{ gridTemplateColumns: tramos.map((f) => `${Math.max(1, diasEntre(f.desde, f.hasta) + 1)}fr`).join(" ") }}>
        {tramos.map((f, i) => (
          <div key={`${f.nombre}-${i}`} className="truncate rounded bg-muted px-2 py-1 text-xs font-medium" title={`${f.nombre} · ${textoRango(f.desde, f.hasta)}`}>
            {i + 1}. {f.nombre}
          </div>
        ))}
      </div>
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {piezas.map((p, i) => (
          <span
            key={i}
            title={`${textoDia(p.fecha)} · ${p.hora} · ${p.titular || p.gancho}`}
            className={cn(
              "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background",
              marcadas.has(i) ? "bg-primary" : "bg-muted-foreground/40",
              p.faltaFoto && "ring-1 ring-amber-500",
            )}
            style={{ left: `${posicionEnRiel(p.fecha, desde, hasta)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{textoDia(desde)}</span>
        <span>{textoDia(hasta)}</span>
      </div>
    </div>
  );
}

function FilaPieza({
  pieza,
  indice,
  marcada,
  editable,
  onMarcar,
  marca,
  onPedirFoto,
}: {
  pieza: PiezaCampanaIA;
  indice: number;
  marcada: boolean;
  editable: boolean;
  onMarcar: (indice: number, v: boolean) => void;
  marca: MarcaId;
  onPedirFoto?: (pieza: PiezaCampanaIA) => void;
}) {
  const plantilla = obtenerPlantilla(pieza.plantilla)?.nombre ?? pieza.plantilla;
  const titulo = pieza.titular || pieza.gancho || plantilla;
  const id = `pieza-campana-${indice}`;
  return (
    <li className="flex items-start gap-2 rounded-md border bg-background p-2" data-testid="pieza-campana">
      {editable && (
        <Checkbox id={id} checked={marcada} onCheckedChange={(v) => onMarcar(indice, v === true)} aria-label={`Incluir «${titulo}»`} className="mt-1" />
      )}
      <MiniaturaFoto
        marca={marca}
        foto={pieza.foto}
        platoId={pieza.platoId}
        falta={pieza.faltaFoto}
        className={cn("aspect-[4/5] w-11 shrink-0", pieza.formato === "story" && "aspect-[9/16] w-9")}
      />
      <div className="min-w-0 flex-1 text-sm">
        <label htmlFor={editable ? id : undefined} className="block font-medium leading-snug">
          {titulo}
        </label>
        <p className="text-xs text-muted-foreground">
          {textoDia(pieza.fecha)} · {pieza.hora} · {pieza.formato === "story" ? "Story" : "Post"} · {plantilla}
          {pieza.plato ? ` · ${pieza.plato.nombre}` : ""}
        </p>
        {pieza.faltaFoto && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#5c4500]">Falta foto</span>
            {onPedirFoto && (
              <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => onPedirFoto(pieza)}>
                <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Pedir foto a Oficiosos
              </Button>
            )}
          </div>
        )}
        {pieza.porQue && <p className="mt-0.5 text-xs text-muted-foreground">{pieza.porQue}</p>}
        {pieza.encargoSugerido && <p className="mt-0.5 text-xs text-muted-foreground">Encargo: {pieza.encargoSugerido}</p>}
      </div>
    </li>
  );
}

/**
 * Pantalla «Campañas». Trae sus datos (TanStack Query): necesita el
 * QueryClientProvider del panel.
 */
export function CampanasInstagram({ marcaInicial = "casa-tomas", onAbrirBorrador, onVerCalendario, marca: marcaPagina = "todas", onAbrirEncargo, className }: CampanasInstagramProps) {
  const qc = useQueryClient();
  const [marca, setMarca] = useState<MarcaId>(marcaPagina !== "todas" ? marcaPagina : marcaInicial);
  useEffect(() => {
    if (marcaPagina !== "todas") setMarca(marcaPagina);
  }, [marcaPagina]);
  const ajustes = useAjustesEncargos();
  const [pedirFoto, setPedirFoto] = useState<{ datos: Partial<DatosFormulario> } | null>(null);
  const [verFormulario, setVerFormulario] = useState(false);
  const [objetivo, setObjetivo] = useState("");
  const [semanas, setSemanas] = useState("3");
  const [porSemana, setPorSemana] = useState("3");
  const manana = sumarDias(hoyMadrid(), 1);
  const [desde, setDesde] = useState(manana);
  const [elegida, setElegida] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<Record<string, Set<number>>>({});
  const [ultimaRespuesta, setUltimaRespuesta] = useState<{ campanaId: string; avisos: string[]; descartadas: number } | null>(null);

  const lista = useQuery({ queryKey: [...CLAVE_CAMPANAS, "lista"], queryFn: () => listarCampanas("todas") });
  const campanas = useMemo(() => (lista.data ?? []).filter((c) => marcaPagina === "todas" || c.marca === marcaPagina), [lista.data, marcaPagina]);
  const actual = campanas.find((c) => c.id === elegida) ?? campanas[0] ?? null;
  useEffect(() => {
    if (!elegida && campanas[0]) setElegida(campanas[0].id);
  }, [campanas, elegida]);

  const seleccion = useMemo(() => {
    if (!actual) return new Set<number>();
    return marcadas[actual.id] ?? new Set(actual.propuesta.piezas.map((_, i) => i));
  }, [actual, marcadas]);

  const borradores = useQuery({
    queryKey: [...CLAVE_CAMPANAS, "borradores", actual?.id ?? ""],
    enabled: Boolean(actual && actual.estado !== "propuesta"),
    queryFn: () => borradoresDeCampana(actual!.id),
  });

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: CLAVE_CAMPANAS });
    void qc.invalidateQueries({ queryKey: ["instagram_piezas"] });
    void qc.invalidateQueries({ queryKey: ["instagram_programaciones"] });
  };

  const proponer = useMutation({
    mutationFn: async (v: { peticion: PeticionCampana; sustituye?: string }) => {
      const r = await proponerCampana(v.peticion);
      // «Proponer de nuevo»: la anterior se descarta solo cuando ya hay otra.
      if (v.sustituye) await descartarCampana(v.sustituye).catch(() => undefined);
      return r;
    },
    onSuccess: (r) => {
      setElegida(r.campanaId);
      setVerFormulario(false);
      setUltimaRespuesta({ campanaId: r.campanaId, avisos: r.avisos, descartadas: r.descartadas.length });
      refrescar();
    },
  });

  const aceptar = useMutation({
    mutationFn: (v: { id: string; indices: number[] }) => aceptarCampana(v.id, v.indices),
    onSuccess: (r) => {
      toast.success(`${r.piezas.length} ${r.piezas.length === 1 ? "borrador añadido" : "borradores añadidos"} al calendario`, {
        description: "Nada se publica sin tu visto bueno: ábrelos en «Crear», genera la imagen y prográmalos.",
        action: onVerCalendario ? { label: "Ver calendario", onClick: onVerCalendario } : undefined,
      });
      refrescar();
    },
    onError: (e) => toast.error("No se pudo aceptar la campaña", { description: textoError(e) }),
  });

  const descartar = useMutation({
    mutationFn: (id: string) => descartarCampana(id),
    onSuccess: () => {
      setElegida(null);
      refrescar();
    },
    onError: (e) => toast.error("No se pudo descartar", { description: textoError(e) }),
  });

  const pedir = () =>
    proponer.mutate({
      peticion: { marca, desde, semanas: Number(semanas), piezasPorSemana: Number(porSemana), objetivo },
    });

  const marcar = (indice: number, v: boolean) => {
    if (!actual) return;
    const s = new Set(seleccion);
    if (v) s.add(indice);
    else s.delete(indice);
    setMarcadas((m) => ({ ...m, [actual.id]: s }));
  };

  const errorProponer = proponer.error as Error | null;
  // Abierto si no hay campañas, si se pidió, o mientras se prepara o falla una propuesta.
  const formularioAbierto = verFormulario || (!lista.isLoading && campanas.length === 0) || proponer.isPending || !!errorProponer;
  const sinFoto = actual?.propuesta.piezas.filter((p) => p.faltaFoto).length ?? 0;
  const editable = actual?.estado === "propuesta";

  return (
    <div
      className={cn("grid min-h-0 gap-3 lg:grid-cols-[minmax(16rem,21rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]", className)}
      data-testid="campanas-instagram"
    >
      {/* Propuestas y «¿Qué quieres empujar?» */}
      <section aria-label="Propuestas de campaña" className="flex min-h-0 flex-col rounded-lg border bg-card">
        <div className="shrink-0 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Propuestas de la IA</h2>
          <p className="text-xs text-muted-foreground">A partir de la carta, la temporada, las fechas señaladas y lo que mejor te funciona.</p>
        </div>
        <ul className="relative min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2" aria-label="Campañas">
          {lista.isLoading && (
            <li className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
            </li>
          )}
          {lista.error && <li className="p-2 text-sm text-destructive">No se pudieron cargar las campañas: {textoError(lista.error)}</li>}
          {!lista.isLoading && !lista.error && campanas.length === 0 && (
            <li className="p-2 text-sm text-muted-foreground">Aún no hay campañas. Pide una abajo.</li>
          )}
          {campanas.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={actual?.id === c.id}
                onClick={() => setElegida(c.id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  actual?.id === c.id && "border-primary bg-primary/5",
                )}
              >
                {(() => {
                  const conFoto = c.propuesta.piezas.find((p) => !p.faltaFoto && (p.foto || p.platoId));
                  return <MiniaturaFoto marca={c.marca} foto={conFoto?.foto} platoId={conFoto?.platoId} className="aspect-square w-12 shrink-0" />;
                })()}
                <span className="min-w-0 flex-1">
                <span className="block font-medium">{c.titulo}</span>
                <span className="block text-xs text-muted-foreground">
                  {NOMBRE_MARCA[c.marca] ?? c.marca} · {textoDuracion(c.desde, c.hasta)} · {textoRango(c.desde, c.hasta)}
                </span>
                <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {c.propuesta.piezas.length} piezas <EstadoCampana estado={c.estado} />
                </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Con campañas en la lista, el formulario va plegado tras «Pedir otra campaña» (la lista conserva el alto en la tablet). */}
        {!formularioAbierto ? (
          <div className="shrink-0 border-t p-3">
            <Button variant="outline" className="w-full" onClick={() => setVerFormulario(true)}>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
              Pedir otra campaña
            </Button>
          </div>
        ) : (
        <div className="shrink-0 space-y-2 border-t p-3">
          <Label htmlFor="campana-objetivo" className="text-sm font-medium">
            ¿Qué quieres empujar?
          </Label>
          <Textarea
            id="campana-objetivo"
            value={objetivo}
            maxLength={MAX_OBJETIVO}
            onChange={(e) => setObjetivo(e.target.value)}
            placeholder="Ej.: llenar los mediodías de diciembre con el menú de empresa"
            className="min-h-16 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" size="sm" variant="outline" value={marca} onValueChange={(v) => v && setMarca(v as MarcaId)} aria-label="Marca">
              <ToggleGroupItem value="casa-tomas" className="h-8 px-2 text-xs">
                Casa Tomás
              </ToggleGroupItem>
              <ToggleGroupItem value="touza" className="h-8 px-2 text-xs">
                Touza
              </ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="single" size="sm" variant="outline" value={semanas} onValueChange={(v) => v && setSemanas(v)} aria-label="Semanas">
              {["2", "3", "4"].map((n) => (
                <ToggleGroupItem key={n} value={n} className="h-8 px-2 text-xs" aria-label={`${n} semanas`}>
                  {n} sem
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="campana-desde" className="text-xs">
                Empieza
              </Label>
              <Input id="campana-desde" type="date" value={desde} min={hoyMadrid()} onChange={(e) => setDesde(e.target.value)} className="h-8 w-36 text-xs" />
            </div>
            <ToggleGroup type="single" size="sm" variant="outline" value={porSemana} onValueChange={(v) => v && setPorSemana(v)} aria-label="Piezas por semana">
              {["2", "3", "4"].map((n) => (
                <ToggleGroupItem key={n} value={n} className="h-8 px-2 text-xs" aria-label={`${n} piezas por semana`}>
                  {n}/sem
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <Button onClick={pedir} disabled={proponer.isPending} className="w-full">
            {proponer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />}
            {proponer.isPending ? "Preparando la campaña…" : "Proponer campaña"}
          </Button>
          {errorProponer && (
            <Alert variant="destructive" className="py-2">
              <AlertDescription className="text-xs">
                {errorProponer.message}
                {errorProponer instanceof ErrorIA && errorProponer.descartadas.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {errorProponer.descartadas.slice(0, 4).map((d, i) => (
                      <li key={i}>{d.motivos.join(" ")}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        )}
      </section>

      {/* Ficha de la campaña */}
      <section aria-label="Ficha de la campaña" className="flex min-h-0 flex-col rounded-lg border bg-card" data-testid="ficha-campana">
        {!actual ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Pide una campaña de 2 a 4 semanas: la IA propone las piezas con su fecha, formato, plantilla y plato. Tú eliges cuáles van al calendario.
          </div>
        ) : (
          <>
            <header className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b p-3">
              <div className="min-w-0">
                <span className="text-xs font-medium uppercase tracking-wide text-[#926a26]">
                  Campaña {editable ? "propuesta" : ""} · {NOMBRE_MARCA[actual.marca] ?? actual.marca}
                </span>
                <h2 className="titular-studio text-xl leading-tight">{actual.titulo}</h2>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {textoDuracion(actual.desde, actual.hasta)} · {textoRango(actual.desde, actual.hasta)}
                  </span>
                  <span>· {actual.propuesta.piezas.length} piezas</span>
                  {sinFoto > 0 && (
                    <Badge variant="outline" className="border-amber-400 text-amber-800">
                      {sinFoto} sin foto
                    </Badge>
                  )}
                  <EstadoCampana estado={actual.estado} />
                </p>
              </div>
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={proponer.isPending}
                  onClick={() => proponer.mutate({ peticion: peticionDeNuevo(actual), sustituye: actual.id })}
                >
                  {proponer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Proponer de nuevo
                </Button>
              )}
            </header>

            <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
              {ultimaRespuesta?.campanaId === actual.id && (ultimaRespuesta.avisos.length > 0 || ultimaRespuesta.descartadas > 0) && (
                <Alert className="py-2">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <AlertDescription className="text-xs">
                    {ultimaRespuesta.descartadas > 0 && <p>La IA propuso {ultimaRespuesta.descartadas} piezas más que no pasaban las comprobaciones (precios, platos o alérgenos sin respaldo en la carta) y se han quitado.</p>}
                    {ultimaRespuesta.avisos.map((a) => (
                      <p key={a}>{a}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Objetivo</h3>
                  <p className="text-sm">{actual.propuesta.objetivo || actual.objetivo || "—"}</p>
                </div>
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Para quién</h3>
                  <p className="text-sm">{actual.propuesta.publico || actual.publico || "—"}</p>
                </div>
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mensaje</h3>
                  <p className="titular-studio text-sm italic">{actual.propuesta.mensaje || actual.mensaje || "—"}</p>
                </div>
              </div>
              {actual.propuesta.razonamiento && <p className="text-xs text-muted-foreground">{actual.propuesta.razonamiento}</p>}

              <LineaTiempo c={actual} marcadas={editable ? seleccion : new Set(actual.propuesta.piezas.map((_, i) => i))} />

              {piezasPorFase(actual.propuesta.piezas, actual.propuesta.fases.length).map((grupo, fi) =>
                grupo.length === 0 ? null : (
                  <div key={fi} className="space-y-1.5">
                    <h3 className="flex items-baseline justify-between text-sm font-semibold">
                      <span>
                        {fi + 1}. {actual.propuesta.fases[fi]?.nombre ?? "Campaña"}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">{grupo.length} piezas</span>
                    </h3>
                    <ul className="grid gap-1.5 xl:grid-cols-2">
                      {grupo.map(({ pieza, indice }) => (
                        <FilaPieza
                          key={indice}
                          pieza={pieza}
                          indice={indice}
                          marcada={seleccion.has(indice)}
                          editable={editable}
                          onMarcar={marcar}
                          marca={actual.marca}
                          onPedirFoto={(p) => setPedirFoto({ datos: encargoDeFoto(actual, p, hoyMadrid()) })}
                        />
                      ))}
                    </ul>
                  </div>
                ),
              )}

              {!editable && (
                <div className="space-y-1.5" data-testid="borradores-campana">
                  <h3 className="text-sm font-semibold">Borradores en el calendario</h3>
                  {borradores.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Cargando" />}
                  {(borradores.data ?? []).map((b) => {
                    const titulo = (typeof b.datos?.titular === "string" && b.datos.titular) || obtenerPlantilla(b.plantilla)?.nombre || "Pieza";
                    const prevista = (b as { fecha_prevista?: string | null }).fecha_prevista;
                    return (
                      <div key={b.id} className="flex items-center gap-2 rounded-md border border-dashed p-2 text-sm">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{titulo}</span>
                          <span className="text-xs text-muted-foreground">
                            {prevista ? textoDia(prevista.slice(0, 10)) : "Sin fecha"} · {b.estado === "borrador" ? "Borrador" : b.estado}
                          </span>
                        </span>
                        {onAbrirBorrador && (
                          <Button variant="outline" size="sm" onClick={() => onAbrirBorrador(b.id)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            Abrir en Crear
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {!borradores.isLoading && (borradores.data ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">No quedan borradores de esta campaña.</p>
                  )}
                </div>
              )}
            </div>

            {editable && (
              <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t p-3">
                <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
                  <b className="text-foreground">
                    {seleccion.size} de {actual.propuesta.piezas.length}
                  </b>{" "}
                  piezas irán al calendario como <b className="text-foreground">borradores</b>. Nada se publica sin tu visto bueno.
                </p>
                <Button variant="ghost" size="sm" disabled={descartar.isPending || aceptar.isPending} onClick={() => descartar.mutate(actual.id)}>
                  <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Descartar
                </Button>
                <Button
                  disabled={seleccion.size === 0 || aceptar.isPending}
                  onClick={() => aceptar.mutate({ id: actual.id, indices: [...seleccion].sort((a, b) => a - b) })}
                >
                  {aceptar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Aceptar y llevar al calendario
                </Button>
              </footer>
            )}
            {!editable && onVerCalendario && (
              <footer className="flex shrink-0 justify-end border-t p-3">
                <Button variant="outline" size="sm" onClick={onVerCalendario}>
                  <CalendarCheck2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Ver en el calendario
                </Button>
              </footer>
            )}
          </>
        )}
      </section>

      {/* «Pedir foto a Oficiosos»: el formulario de encargos, ya rellenado con la pieza. */}
      {pedirFoto && (
        <FormularioEncargo
          abierto
          onAbierto={(v) => !v && setPedirFoto(null)}
          datosIniciales={pedirFoto.datos}
          ajustes={ajustes.data ?? { plazo_dias_laborables: 5, rondas_incluidas: 2, cupo_mensual: null }}
          onHecho={(id) => onAbrirEncargo?.(id)}
        />
      )}
    </div>
  );
}
