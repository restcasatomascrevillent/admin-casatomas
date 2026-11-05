import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ImageIcon, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ListaOrdenable } from "@/components/ui/lista-ordenable";
import { cn } from "@/lib/utils";
import {
  CTAS_REEL,
  DATOS_MARCA_REEL,
  ESTILOS_ROTULO,
  INFO_BASES,
  LIMITES_REEL,
  TRANSICIONES_AVANZADAS,
  TRANSICIONES_BASICAS,
  anadirEscena,
  calcularTiempos,
  cambiarCierre,
  cambiarEscena,
  crearReelDesdeBase,
  crearResolverFotos,
  esMuestra,
  formatearSegundos,
  moverEscena,
  puedeAnadirEscena,
  puedeQuitarEscena,
  quitarEscena,
  validarReel,
  type BaseReel,
  type CierreReel,
  type EncuadreReel,
  type EscenaReel,
  type EstiloRotulo,
  type FotoElegida,
  type MarcaReel,
  type ReelPieza,
  type ResolverFoto,
  type RotuloReel,
  type TransicionReel,
} from "@/lib/instagram/reels";

/** Lo que recibe elegirFoto: para qué escena y de qué marca. */
export interface PeticionFotoReel {
  marca: MarcaReel;
  /** Índice de la escena, o "cierre". */
  escena: number | "cierre";
  nombre: string;
  /** Qué foto pide la escena (nota de la base). */
  nota?: string;
  /** id de la foto actual, si la hay. */
  fotoActual?: string;
}

export interface EditorReelProps {
  reel: ReelPieza;
  onChange: (reel: ReelPieza) => void;
  /**
   * Abre el selector de fotos del panel (biblioteca de Drive o carta) y
   * devuelve la elegida, o null si se cancela. Sin esta prop, el botón
   * «Elegir foto» no aparece.
   */
  elegirFoto?: (peticion: PeticionFotoReel) => Promise<FotoElegida | null | undefined> | FotoElegida | null | undefined;
  /** Se llama con cada foto elegida (para que el padre guarde su URL y se vea en la vista previa). */
  onFotoElegida?: (foto: FotoElegida) => void;
  /** id de foto → URL para las miniaturas. Por defecto, solo las muestras. */
  urlFoto?: ResolverFoto;
  /** Escena seleccionada (controlada). Índice = nº de escenas → el cierre. */
  seleccion?: number;
  onSeleccion?: (indice: number) => void;
  /** Muestra «Empezar desde una base» (por defecto, sí). */
  permitirCambiarBase?: boolean;
  className?: string;
}

const CLASE_SELECT =
  "h-10 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const NOMBRE_TRANSICION: Record<TransicionReel, string> = {
  dissolve: "Fundido",
  zoom: "Zoom",
  rise: "Subida",
  blur: "Desenfoque",
  wipe: "Cortina con línea oro",
  push: "Empuje lateral",
  iris: "Círculo (iris)",
  flash: "Destello",
  glass: "Apertura en vertical",
};

const NOMBRE_ESTILO: Record<EstiloRotulo, string> = {
  intro: "Intro: logo y antetítulo",
  hook: "Gancho: titular grande al centro",
  label: "Etiqueta: barra oro abajo",
  mask: "Titular en cursiva que sube",
  box: "Caja oscura con líneas",
  letters: "Frase letra a letra",
  pill: "Píldora y titular",
  number: "Cifra grande",
};

/** Qué campos usa cada estilo. */
const CAMPOS_ESTILO: Record<EstiloRotulo, Array<"antetitulo" | "titulo" | "sub" | "alinear" | "tamano">> = {
  intro: ["antetitulo"],
  hook: ["antetitulo", "titulo", "sub", "tamano"],
  label: ["antetitulo", "titulo", "sub", "tamano"],
  mask: ["titulo", "sub", "tamano"],
  box: ["antetitulo", "titulo", "sub", "tamano"],
  letters: ["antetitulo", "titulo", "tamano"],
  pill: ["antetitulo", "titulo", "sub", "alinear", "tamano"],
  number: ["antetitulo", "titulo", "sub", "tamano"],
};

const num = (v: string, porDefecto: number) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : porDefecto;
};

/**
 * Editor de un reel: escenas (añadir, quitar, reordenar arrastrando o con
 * flechas), foto, duración, transición y rótulo de cada una, y el cierre.
 * Controlado: recibe el reel y devuelve uno nuevo en onChange. Pensado para
 * tablet: ocupa el alto del padre y hace scroll por dentro.
 */
export function EditorReel({
  reel,
  onChange,
  elegirFoto,
  onFotoElegida,
  urlFoto,
  seleccion: seleccionControlada,
  onSeleccion,
  permitirCambiarBase = true,
  className,
}: EditorReelProps) {
  const [seleccionPropia, setSeleccionPropia] = useState(0);
  const [medidas, setMedidas] = useState<Record<string, { ancho: number; alto: number }>>({});
  const [eligiendo, setEligiendo] = useState<number | "cierre" | null>(null);
  const [baseNueva, setBaseNueva] = useState<BaseReel | "">("");
  const n = reel.escenas.length;
  const seleccion = Math.min(seleccionControlada ?? seleccionPropia, n);
  const seleccionar = (i: number) => {
    setSeleccionPropia(i);
    onSeleccion?.(i);
  };
  const resolver = useMemo(() => urlFoto ?? crearResolverFotos(), [urlFoto]);
  const tiempos = calcularTiempos(reel);
  const validacion = useMemo(() => validarReel(reel, { medidasFoto: (id) => medidas[id] }), [reel, medidas]);
  const problemas = validacion.problemas ?? [];
  const avisos = validacion.avisos;
  const totalFuera = tiempos.total < LIMITES_REEL.totalMin || tiempos.total > LIMITES_REEL.totalMax;

  const problemasDe = (i: number | "cierre") => {
    const prefijo = i === "cierre" ? "Cierre" : `Escena ${i + 1} «`;
    const ruta = i === "cierre" ? "«cierre." : `«escenas[${i}]`;
    return problemas.filter((p) => p.startsWith(prefijo) || p.startsWith(ruta));
  };

  const pedirFoto = async (i: number | "cierre") => {
    if (!elegirFoto) return;
    const e = i === "cierre" ? null : reel.escenas[i];
    setEligiendo(i);
    try {
      const foto = await elegirFoto({
        marca: reel.marca,
        escena: i,
        nombre: e ? e.nombre : "Cierre",
        nota: e?.nota,
        fotoActual: e ? e.foto : reel.cierre.foto,
      });
      if (!foto) return;
      if (foto.ancho && foto.alto) setMedidas((m) => ({ ...m, [foto.id]: { ancho: foto.ancho!, alto: foto.alto! } }));
      onFotoElegida?.(foto);
      onChange(i === "cierre" ? cambiarCierre(reel, { foto: foto.id }) : cambiarEscena(reel, i, { foto: foto.id }));
    } finally {
      setEligiendo(null);
    }
  };

  const anadir = () => {
    const despues = Math.min(seleccion, n - 1);
    onChange(anadirEscena(reel, despues));
    seleccionar(despues + 1);
  };
  const quitar = (i: number) => {
    onChange(quitarEscena(reel, i));
    if (seleccion >= i && seleccion > 0) seleccionar(seleccion - 1);
  };
  const mover = (desde: number, hasta: number) => {
    onChange(moverEscena(reel, desde, hasta));
    if (seleccion === desde) seleccionar(hasta);
  };

  const miniatura = (foto: string | undefined, nombre: string) => {
    const url = foto ? resolver(foto) : undefined;
    return (
      <div className="relative h-14 w-8 shrink-0 overflow-hidden rounded bg-muted">
        {url ? (
          <img src={url} alt={`Foto de «${nombre}»`} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <ImageIcon className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        {foto && esMuestra(foto) && <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[8px] leading-3 text-white">muestra</span>}
      </div>
    );
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      {/* Cabecera: base y duración */}
      <div className="flex shrink-0 flex-wrap items-end gap-2">
        {permitirCambiarBase && (
          <div className="flex min-w-0 flex-1 items-end gap-2">
            <div className="min-w-0 flex-1">
              <Label htmlFor="reel-base" className="text-xs">
                Empezar desde una base
              </Label>
              <select id="reel-base" className={CLASE_SELECT} value={baseNueva} onChange={(e) => setBaseNueva(e.target.value as BaseReel | "")}>
                <option value="">Base actual: {INFO_BASES.find((b) => b.id === reel.base)?.nombre ?? reel.base}</option>
                {INFO_BASES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                    {b.marca ? ` (${DATOS_MARCA_REEL[b.marca].nombre})` : ""}
                  </option>
                ))}
              </select>
            </div>
            {baseNueva && (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    onChange(crearReelDesdeBase(baseNueva, reel.marca));
                    setBaseNueva("");
                    seleccionar(0);
                  }}
                >
                  Sustituir el reel
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Cancelar el cambio de base" onClick={() => setBaseNueva("")}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        )}
        <div className={cn("rounded-md border px-3 py-2 text-sm tabular-nums", totalFuera ? "border-destructive text-destructive" : "text-muted-foreground")}>
          {n} {n === 1 ? "escena" : "escenas"} + cierre · <strong>{formatearSegundos(tiempos.total)}</strong>
          <span className="text-xs"> (de {LIMITES_REEL.totalMin} a {LIMITES_REEL.totalMax} s)</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="editor-reel-desplazable">
        {/* Lista de escenas */}
        <ListaOrdenable
          ids={reel.escenas.map((e) => e.id)}
          nombre={(id) => reel.escenas.find((e) => e.id === id)?.nombre ?? id}
          onMover={mover}
          className="flex flex-col gap-1"
          aria-label="Escenas del reel"
        >
          {(id, i, { asa }) => {
            const e = reel.escenas[i];
            const [ini] = tiempos.tramos[i];
            const conProblemas = problemasDe(i).length > 0;
            return (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border p-1 pr-2",
                  seleccion === i ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50",
                )}
                data-escena={id}
              >
                {asa}
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => seleccionar(i)} aria-pressed={seleccion === i}>
                  {miniatura(e.foto, e.nombre)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {i + 1}. {e.nombre}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatearSegundos(ini)} · {formatearSegundos(e.duracion_s)}
                      {e.rotulo?.titulo ? ` · ${e.rotulo.titulo}` : ""}
                    </span>
                  </span>
                  {conProblemas && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-label="Tiene problemas" />}
                </button>
                <Button type="button" size="icon" variant="ghost" className="hidden sm:inline-flex" disabled={i === 0} onClick={() => mover(i, i - 1)} aria-label={`Subir «${e.nombre}»`}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="hidden sm:inline-flex" disabled={i === n - 1} onClick={() => mover(i, i + 1)} aria-label={`Bajar «${e.nombre}»`}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" disabled={!puedeQuitarEscena(reel)} onClick={() => quitar(i)} aria-label={`Quitar «${e.nombre}»`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          }}
        </ListaOrdenable>

        <div className="mt-1 flex flex-col gap-1">
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={anadir} disabled={!puedeAnadirEscena(reel)}>
            <Plus className="mr-1 h-4 w-4" /> Añadir escena
          </Button>
          <button
            type="button"
            className={cn("flex items-center gap-2 rounded-md border p-1 pl-12 pr-2 text-left", seleccion === n ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50")}
            onClick={() => seleccionar(n)}
            aria-pressed={seleccion === n}
            data-escena="cierre"
          >
            {miniatura(reel.cierre.foto, "Cierre")}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Cierre</span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatearSegundos(tiempos.inicioCierre)} · {formatearSegundos(reel.cierre.duracion_s)} · {reel.cierre.cta}
              </span>
            </span>
            {problemasDe("cierre").length > 0 && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-label="Tiene problemas" />}
          </button>
        </div>

        {/* Detalle de la selección */}
        <div className="mt-3 rounded-lg border p-3">
          {seleccion < n ? (
            <DetalleEscena
              key={reel.escenas[seleccion].id}
              escena={reel.escenas[seleccion]}
              indice={seleccion}
              onCambio={(c) => onChange(cambiarEscena(reel, seleccion, c))}
              foto={
                <SelectorFotoEscena
                  foto={reel.escenas[seleccion].foto}
                  nota={reel.escenas[seleccion].nota}
                  url={reel.escenas[seleccion].foto ? resolver(reel.escenas[seleccion].foto!) : undefined}
                  puedeElegir={!!elegirFoto}
                  eligiendo={eligiendo === seleccion}
                  onElegir={() => void pedirFoto(seleccion)}
                  onQuitar={() => onChange(cambiarEscena(reel, seleccion, { foto: undefined }))}
                />
              }
            />
          ) : (
            <DetalleCierre
              cierre={reel.cierre}
              marca={reel.marca}
              onCambio={(c) => onChange(cambiarCierre(reel, c))}
              foto={
                <SelectorFotoEscena
                  foto={reel.cierre.foto}
                  url={reel.cierre.foto ? resolver(reel.cierre.foto) : undefined}
                  puedeElegir={!!elegirFoto}
                  eligiendo={eligiendo === "cierre"}
                  onElegir={() => void pedirFoto("cierre")}
                  onQuitar={() => onChange(cambiarCierre(reel, { foto: undefined }))}
                />
              }
            />
          )}
        </div>
      </div>

      {(problemas.length > 0 || avisos.length > 0) && (
        <div className="max-h-28 shrink-0 overflow-y-auto rounded-md border p-2 text-xs" aria-live="polite">
          {problemas.map((p) => (
            <p key={p} className="text-destructive">
              {p}
            </p>
          ))}
          {avisos.map((a) => (
            <p key={a} className="text-amber-700 dark:text-amber-400">
              {a}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Piezas del detalle ───────────────────────────────────────────────────────

function Campo({ id, etiqueta, children, ayuda }: { id: string; etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {etiqueta}
      </Label>
      {children}
      {ayuda && <span className="text-[11px] text-muted-foreground">{ayuda}</span>}
    </div>
  );
}

function SelectorFotoEscena(props: {
  foto?: string;
  nota?: string;
  url?: string;
  puedeElegir: boolean;
  eligiendo: boolean;
  onElegir: () => void;
  onQuitar: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-24 w-[54px] shrink-0 overflow-hidden rounded bg-muted">
        {props.url ? <img src={props.url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" aria-hidden />}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-xs text-muted-foreground">
          {props.foto ? (esMuestra(props.foto) ? "Foto de muestra (cámbiala antes del vídeo)" : props.foto) : "Sin foto"}
        </span>
        {props.nota && <span className="text-xs italic text-muted-foreground">Pide: {props.nota}</span>}
        <div className="flex gap-2">
          {props.puedeElegir && (
            <Button type="button" size="sm" variant="outline" onClick={props.onElegir} disabled={props.eligiendo}>
              {props.eligiendo ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-1 h-4 w-4" />}
              {props.foto ? "Cambiar foto" : "Elegir foto"}
            </Button>
          )}
          {props.foto && (
            <Button type="button" size="sm" variant="ghost" onClick={props.onQuitar}>
              Quitar foto
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectTransicion({ id, valor, onCambio, disabled }: { id: string; valor?: TransicionReel; onCambio: (t: TransicionReel | undefined) => void; disabled?: boolean }) {
  return (
    <select id={id} className={CLASE_SELECT} value={valor ?? ""} disabled={disabled} onChange={(e) => onCambio((e.target.value || undefined) as TransicionReel | undefined)}>
      <option value="">Corte seco</option>
      <optgroup label="Recomendadas">
        {TRANSICIONES_BASICAS.map((t) => (
          <option key={t} value={t}>
            {NOMBRE_TRANSICION[t]}
          </option>
        ))}
      </optgroup>
      <optgroup label="Avanzadas (más llamativas)">
        {TRANSICIONES_AVANZADAS.map((t) => (
          <option key={t} value={t}>
            {NOMBRE_TRANSICION[t]}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function CamposEncuadre({ prefijo, encuadre, onCambio }: { prefijo: string; encuadre: EncuadreReel; onCambio: (e: EncuadreReel) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Campo id={`${prefijo}-zoom-a`} etiqueta="Zoom al empezar">
        <Input
          id={`${prefijo}-zoom-a`}
          type="number"
          inputMode="decimal"
          step={0.05}
          min={0.8}
          max={2.5}
          value={encuadre.zoom[0]}
          onChange={(e) => onCambio({ ...encuadre, zoom: [num(e.target.value, encuadre.zoom[0]), encuadre.zoom[1]] })}
        />
      </Campo>
      <Campo id={`${prefijo}-zoom-b`} etiqueta="Zoom al acabar">
        <Input
          id={`${prefijo}-zoom-b`}
          type="number"
          inputMode="decimal"
          step={0.05}
          min={0.8}
          max={2.5}
          value={encuadre.zoom[1]}
          onChange={(e) => onCambio({ ...encuadre, zoom: [encuadre.zoom[0], num(e.target.value, encuadre.zoom[1])] })}
        />
      </Campo>
      <Campo id={`${prefijo}-pos`} etiqueta="Centro (X% Y%)">
        <Input id={`${prefijo}-pos`} value={encuadre.pos} onChange={(e) => onCambio({ ...encuadre, pos: e.target.value })} />
      </Campo>
    </div>
  );
}

function DetalleEscena({ escena, indice, onCambio, foto }: { escena: EscenaReel; indice: number; onCambio: (c: Partial<EscenaReel>) => void; foto: ReactNode }) {
  const p = `escena-${escena.id}`;
  const r = escena.rotulo;
  const campos = r ? CAMPOS_ESTILO[r.estilo] : [];
  const cambiarRotulo = (c: Partial<RotuloReel>) => {
    if (!r) return;
    const nuevo = { ...r, ...c };
    for (const k of Object.keys(nuevo) as Array<keyof RotuloReel>) if (nuevo[k] === undefined || nuevo[k] === "") delete nuevo[k];
    onCambio({ rotulo: nuevo });
  };
  const texto = (v: string) => (v === "" ? undefined : v);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Escena {indice + 1}</h3>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <Campo id={`${p}-nombre`} etiqueta="Nombre">
          <Input id={`${p}-nombre`} value={escena.nombre} maxLength={40} onChange={(e) => onCambio({ nombre: e.target.value })} />
        </Campo>
        <Campo id={`${p}-duracion`} etiqueta="Duración (s)">
          <Input
            id={`${p}-duracion`}
            type="number"
            inputMode="decimal"
            step={0.5}
            min={LIMITES_REEL.escenaMin}
            max={LIMITES_REEL.escenaMax}
            value={escena.duracion_s}
            onChange={(e) => onCambio({ duracion_s: num(e.target.value, escena.duracion_s) })}
          />
        </Campo>
      </div>
      {foto}
      <Campo id={`${p}-transicion`} etiqueta="Cómo entra" ayuda={indice === 0 ? "La primera escena entra con el fundido de apertura." : undefined}>
        <SelectTransicion id={`${p}-transicion`} valor={escena.transicion} disabled={indice === 0} onCambio={(t) => onCambio({ transicion: t })} />
      </Campo>
      <CamposEncuadre prefijo={p} encuadre={escena.encuadre} onCambio={(e) => onCambio({ encuadre: e })} />

      <Campo id={`${p}-estilo`} etiqueta="Rótulo">
        <select
          id={`${p}-estilo`}
          className={CLASE_SELECT}
          value={r?.estilo ?? ""}
          onChange={(e) => {
            const estilo = e.target.value as EstiloRotulo | "";
            if (!estilo) return onCambio({ rotulo: undefined });
            if (estilo === "intro") return onCambio({ rotulo: { estilo, antetitulo: r?.antetitulo } as RotuloReel });
            const base: RotuloReel = { ...(r ?? {}), estilo, titulo: r?.titulo ?? "Título" };
            if (estilo !== "pill") delete base.alinear;
            onCambio({ rotulo: Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined)) as RotuloReel });
          }}
        >
          <option value="">Sin rótulo</option>
          {ESTILOS_ROTULO.map((s) => (
            <option key={s} value={s}>
              {NOMBRE_ESTILO[s]}
            </option>
          ))}
        </select>
      </Campo>
      {r && (
        <div className="grid gap-2 sm:grid-cols-2">
          {campos.includes("antetitulo") && (
            <Campo id={`${p}-ante`} etiqueta="Antetítulo">
              <Input id={`${p}-ante`} value={r.antetitulo ?? ""} maxLength={60} onChange={(e) => cambiarRotulo({ antetitulo: texto(e.target.value) })} />
            </Campo>
          )}
          {campos.includes("titulo") && (
            <Campo id={`${p}-titulo`} etiqueta={`Título (máx. ${LIMITES_REEL.palabrasTitulo} palabras)`}>
              <Input id={`${p}-titulo`} value={r.titulo ?? ""} maxLength={60} onChange={(e) => cambiarRotulo({ titulo: texto(e.target.value) })} />
            </Campo>
          )}
          {campos.includes("sub") && (
            <Campo id={`${p}-sub`} etiqueta="Detalle">
              <Input id={`${p}-sub`} value={r.sub ?? ""} maxLength={60} onChange={(e) => cambiarRotulo({ sub: texto(e.target.value) })} />
            </Campo>
          )}
          {campos.includes("tamano") && (
            <Campo id={`${p}-tamano`} etiqueta="Tamaño del título (%)">
              <Input
                id={`${p}-tamano`}
                type="number"
                inputMode="numeric"
                step={5}
                min={50}
                max={130}
                value={Math.round((r.tamano ?? 1) * 100)}
                onChange={(e) => {
                  const v = num(e.target.value, 100) / 100;
                  cambiarRotulo({ tamano: v === 1 ? undefined : v });
                }}
              />
            </Campo>
          )}
          {campos.includes("alinear") && (
            <Campo id={`${p}-alinear`} etiqueta="Lado">
              <select id={`${p}-alinear`} className={CLASE_SELECT} value={r.alinear ?? "derecha"} onChange={(e) => cambiarRotulo({ alinear: e.target.value === "izquierda" ? "izquierda" : undefined })}>
                <option value="derecha">Derecha</option>
                <option value="izquierda">Izquierda</option>
              </select>
            </Campo>
          )}
        </div>
      )}
    </div>
  );
}

function DetalleCierre({ cierre, marca, onCambio, foto }: { cierre: CierreReel; marca: MarcaReel; onCambio: (c: Partial<CierreReel>) => void; foto: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-2">
        <h3 className="text-sm font-semibold">Cierre: logo, frase, botón y datos</h3>
        <Campo id="cierre-duracion" etiqueta="Duración (s)">
          <Input
            id="cierre-duracion"
            type="number"
            inputMode="decimal"
            step={0.5}
            min={LIMITES_REEL.cierreMin}
            max={LIMITES_REEL.cierreMax}
            value={cierre.duracion_s}
            onChange={(e) => onCambio({ duracion_s: num(e.target.value, cierre.duracion_s) })}
          />
        </Campo>
      </div>
      {foto}
      <Campo id="cierre-transicion" etiqueta="Cómo entra">
        <SelectTransicion id="cierre-transicion" valor={cierre.transicion} onCambio={(t) => onCambio({ transicion: t })} />
      </Campo>
      <CamposEncuadre prefijo="cierre" encuadre={cierre.encuadre} onCambio={(e) => onCambio({ encuadre: e })} />
      <Campo id="cierre-frase" etiqueta="Frase">
        <Textarea id="cierre-frase" rows={2} maxLength={120} value={cierre.frase} onChange={(e) => onCambio({ frase: e.target.value })} />
      </Campo>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo id="cierre-cta" etiqueta="Botón">
          <select id="cierre-cta" className={CLASE_SELECT} value={cierre.cta} onChange={(e) => onCambio({ cta: e.target.value as CierreReel["cta"] })}>
            {CTAS_REEL.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Campo>
        <Campo id="cierre-datos" etiqueta="Datos" ayuda="Vacío: los de la marca.">
          <Input
            id="cierre-datos"
            value={cierre.datos ?? ""}
            maxLength={60}
            placeholder={DATOS_MARCA_REEL[marca].datosCierre}
            onChange={(e) => onCambio({ datos: e.target.value === "" ? undefined : e.target.value })}
          />
        </Campo>
      </div>
    </div>
  );
}
