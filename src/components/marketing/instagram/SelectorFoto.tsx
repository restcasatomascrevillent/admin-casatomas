import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ImageOff, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FORMATOS,
  TIPOS_FOTO,
  escalaParaCubrir,
  esAptaPara,
  urlRecurso,
  type Foto,
  type FormatoId,
  type MarcaId,
  type Plantilla,
  type TipoFoto,
} from "@/lib/instagram";
import { miniaturaDrive, textoError } from "./api";
import { SubirFotoDialog } from "./SubirFotoDialog";
import { anotarMedidasCarta, useFotosInstagram } from "./useFotosInstagram";
import { EtiquetaOriginal } from "./EtiquetaOriginal";

const NOMBRE_FORMATO: Record<FormatoId, string> = { post: "un post", story: "una story" };

/** Por qué una foto no se puede usar (o null si se puede). Misma regla que validarPieza. */
export function motivoNoApta(foto: Foto, formato: FormatoId, plantilla?: Pick<Plantilla, "tiposFoto">): string | null {
  if (foto.problema) return foto.problema;
  // Sin tipo (foto de Drive sin clasificar): vale para cualquier plantilla.
  if (foto.tipo && plantilla?.tiposFoto?.length && !plantilla.tiposFoto.includes(foto.tipo)) {
    return `Esta plantilla no usa fotos de tipo «${foto.tipo}».`;
  }
  // Foto de la carta cuyas medidas aún no se saben (no ha cargado la miniatura): no se bloquea;
  // al cargar o al prepararla llegan las reales y la validación de la pieza manda.
  if ((!foto.ancho || !foto.alto) && (foto.platoId || foto.vinoId)) return null;
  if (!foto.ancho || !foto.alto) return "Drive todavía no sabe las medidas de esta foto: vuelve a abrir la biblioteca en un rato.";
  if (!esAptaPara(foto, formato)) {
    const f = FORMATOS[formato];
    const ampliar = Math.round((escalaParaCubrir(foto.ancho, foto.alto, f.ancho, f.alto) - 1) * 100);
    const forma = foto.ancho > foto.alto ? "Es apaisada" : "Es pequeña";
    return `${forma} (${foto.ancho}×${foto.alto}): para ${NOMBRE_FORMATO[formato]} habría que ampliarla un ${ampliar} % y se vería borrosa.`;
  }
  return null;
}

/** Tipo con el que se abre «Subir foto»: el primero que admite la plantilla (o «plato»). */
function tipoPorDefecto(plantilla?: Pick<Plantilla, "tiposFoto">): TipoFoto {
  const t = plantilla?.tiposFoto?.[0];
  return (TIPOS_FOTO as readonly string[]).includes(t ?? "") ? (t as TipoFoto) : "plato";
}

/** Miniatura de una foto de Drive: se pide con la sesión y se enseña como blob URL. */
export function MiniaturaDrive({ marca, driveId }: { marca: MarcaId; driveId: string }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["instagram_drive_miniatura", driveId],
    queryFn: () => miniaturaDrive(marca, driveId),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return setUrl(null);
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  if (url) return <img src={url} alt="" decoding="async" className="h-full w-full object-cover" />;
  return (
    <span className="flex h-full w-full items-center justify-center text-muted-foreground">
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImageOff className="h-4 w-4" aria-hidden="true" />}
      {isError && <span className="sr-only">Sin miniatura</span>}
    </span>
  );
}

/** Miniatura de una foto de la carta: URL pública del bucket «platos»; al cargar apunta sus medidas reales. */
export function MiniaturaCarta({ platoId, url }: { platoId: string; url: string }) {
  const qc = useQueryClient();
  const [rota, setRota] = useState(false);
  if (rota) {
    return (
      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Sin miniatura</span>
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
      onLoad={(e) => anotarMedidasCarta(qc, platoId, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
      onError={() => setRota(true)}
    />
  );
}

type FiltroOrigen = "todas" | "drive" | "carta" | "vinos";
const FILTROS: ReadonlyArray<{ id: FiltroOrigen; nombre: string }> = [
  { id: "todas", nombre: "Todas" },
  { id: "drive", nombre: "Drive" },
  { id: "carta", nombre: "Carta" },
  { id: "vinos", nombre: "Vinos" },
];
const origenDe = (f: Foto): Exclude<FiltroOrigen, "todas"> => (f.vinoId ? "vinos" : f.platoId ? "carta" : "drive");

interface Props {
  marca: MarcaId;
  formato: FormatoId;
  plantilla?: Plantilla;
  valor: string;
  onCambio: (id: string) => void;
  /** Base pública del bucket (solo para fotos antiguas que no son de Drive). */
  baseFotos: string;
  conProblema?: boolean;
}

export function SelectorFoto({ marca, formato, plantilla, valor, onCambio, baseFotos, conProblema }: Props) {
  // Biblioteca de la marca en Google Drive (Edge Function instagram-drive).
  // Más los platos de la carta con foto (tipo «plato», id «carta:<id>»).
  const { fotos: todas, avisos, cargando, error, cargandoCarta, errorCarta } = useFotosInstagram(marca);
  const [filtro, setFiltro] = useState<FiltroOrigen>("todas");
  const cuantas: Record<FiltroOrigen, number> = {
    todas: todas.length,
    drive: todas.filter((f) => origenDe(f) === "drive").length,
    carta: todas.filter((f) => origenDe(f) === "carta").length,
    vinos: todas.filter((f) => origenDe(f) === "vinos").length,
  };
  const fotos = filtro === "todas" ? todas : todas.filter((f) => origenDe(f) === filtro);
  // En el móvil no hay «title» al pasar el ratón: al tocar una foto que no vale se explica debajo.
  const [aviso, setAviso] = useState<string | null>(null);
  const [subir, setSubir] = useState(false);

  return (
    <fieldset className={cn("rounded-md", conProblema && "ring-2 ring-destructive ring-offset-2")} aria-describedby="ayuda-foto">
      <legend className="text-sm font-medium">Foto</legend>
      {/* Una sola fila: de dónde salen las fotos y «Subir foto». La ayuda, corta y debajo. */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
      <div role="group" aria-label="Origen de las fotos" className="flex flex-wrap gap-1">
        {FILTROS.map((f) => (
          <Button
            key={f.id}
            type="button"
            size="sm"
            variant={filtro === f.id ? "secondary" : "ghost"}
            aria-pressed={filtro === f.id}
            data-testid={`filtro-origen-${f.id}`}
            onClick={() => setFiltro(f.id)}
            className="h-7 px-2 text-xs pointer-coarse:min-h-11"
          >
            {f.nombre} ({cuantas[f.id]})
          </Button>
        ))}
      </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setSubir(true)} className="h-7 shrink-0 px-2 pointer-coarse:min-h-11">
          <ImagePlus className="mr-1 h-4 w-4" aria-hidden="true" />
          Subir foto
        </Button>
      </div>
      <p id="ayuda-foto" className="mb-2 text-xs text-muted-foreground">
        Las grises no sirven para este formato: tócalas para ver por qué. Las de Drive se borran en Drive.
      </p>
      {avisos.map((a) => (
        <p key={a} className="mb-2 flex items-start gap-1.5 text-xs text-amber-700" data-testid="aviso-biblioteca">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{a}</span>
        </p>
      ))}
      {cargando && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Cargando las fotos de Drive…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive" data-testid="error-biblioteca">
          No se pueden cargar las fotos de Drive: {textoError(error)} Mira la pestaña «Conexión» → Comprobar.
        </p>
      )}
      {errorCarta && filtro !== "drive" && (
        <p role="alert" className="mb-2 text-xs text-destructive" data-testid="error-carta">
          No se pueden cargar las fotos de la carta: {textoError(errorCarta)}
        </p>
      )}
      {!cargando && !error && filtro === "drive" && cuantas.drive === 0 && (
        <p className="text-xs text-muted-foreground">Aún no hay fotos en la carpeta de Drive de esta marca: sube la primera con «Subir foto».</p>
      )}
      {!cargandoCarta && !errorCarta && filtro === "carta" && cuantas.carta === 0 && (
        <p className="text-xs text-muted-foreground">No hay platos activos con foto en la carta de esta marca.</p>
      )}
      <div role="radiogroup" aria-label="Foto" className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-4">
        {fotos.map((foto) => {
          const motivo = motivoNoApta(foto, formato, plantilla);
          const elegida = valor === foto.id;
          const descripcion = foto.descripcion || (foto.tipo ? `Foto (${foto.tipo})` : "Foto sin clasificar");
          return (
            <div key={foto.id} className="relative">
              <button
                type="button"
                role="radio"
                aria-checked={elegida}
                aria-disabled={motivo ? true : undefined}
                title={motivo ?? descripcion}
                aria-label={`${foto.vinoId ? "Vino: " : foto.platoId ? "Carta: " : ""}${descripcion}${motivo ? ` No disponible: ${motivo}` : ""}`}
                data-testid={`foto-${foto.id}`}
                // aria-disabled (no `disabled`): sigue siendo enfocable y el lector de pantalla lee el motivo.
                onClick={() => {
                  if (motivo) return setAviso(motivo);
                  setAviso(null);
                  onCambio(foto.id);
                }}
                className={cn(
                  "relative block aspect-[4/5] w-full overflow-hidden rounded-md border bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  elegida ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/60",
                  motivo && "cursor-not-allowed opacity-40 grayscale",
                )}
              >
                {(foto.platoId || foto.vinoId) && foto.urlCarta ? (
                  <MiniaturaCarta platoId={foto.platoId ?? foto.id} url={foto.urlCarta} />
                ) : foto.driveId ? (
                  <MiniaturaDrive marca={foto.marca} driveId={foto.driveId} />
                ) : (
                  <img src={urlRecurso(baseFotos, foto.ruta)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                )}
                {(foto.platoId || foto.vinoId) && (
                  <span className="absolute bottom-1 left-1 rounded bg-primary/90 px-1 text-[10px] font-medium leading-4 text-primary-foreground" aria-hidden="true">
                    {foto.vinoId ? "Vino" : "Carta"}
                  </span>
                )}
                <EtiquetaOriginal foto={foto} />
                {!foto.tipo && (
                  <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] font-medium leading-4 text-foreground" aria-hidden="true">
                    Sin clasificar
                  </span>
                )}
                {elegida && (
                  <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground" aria-hidden="true">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
      {aviso && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {aviso}
        </p>
      )}
      {valor && (() => {
        const elegida = todas.find((f) => f.id === valor);
        const motivo = elegida ? motivoNoApta(elegida, formato, plantilla) : null;
        return motivo ? <p className="mt-1 text-xs text-destructive">La foto elegida no vale: {motivo}</p> : null;
      })()}

      <SubirFotoDialog
        abierto={subir}
        onAbierto={setSubir}
        marca={marca}
        tipoInicial={tipoPorDefecto(plantilla)}
        onSubida={(foto) => {
          if (foto.marca !== marca) return;
          setAviso(null);
          onCambio(foto.id);
        }}
      />
    </fieldset>
  );
}
