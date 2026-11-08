import { useState } from "react";
import { AlertTriangle, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { urlRecurso, type Foto, type FormatoId, type MarcaId } from "@/lib/instagram";
import { MAX_FOTOS_CARRUSEL } from "@/lib/instagram/montar";
import { MiniaturaCarta, MiniaturaDrive, motivoNoApta } from "@/components/marketing/instagram/SelectorFoto";
import { EtiquetaOriginal } from "@/components/marketing/instagram/EtiquetaOriginal";
import { SubirFotoDialog } from "@/components/marketing/instagram/SubirFotoDialog";
import { textoError } from "@/components/marketing/instagram/api";
import { useFotosInstagram } from "@/components/marketing/instagram/useFotosInstagram";

type Origen = "todas" | "drive" | "carta";
const ORIGENES: ReadonlyArray<{ id: Origen; nombre: string }> = [
  { id: "todas", nombre: "Todas" },
  { id: "drive", nombre: "Drive" },
  { id: "carta", nombre: "Carta" },
];

/** Miniatura de cualquier foto del catálogo (Drive, carta o bucket). */
export function MiniaturaFoto({ foto, baseFotos }: { foto: Foto; baseFotos: string }) {
  if (foto.platoId && foto.urlCarta) return <MiniaturaCarta platoId={foto.platoId} url={foto.urlCarta} />;
  if (foto.driveId) return <MiniaturaDrive marca={foto.marca} driveId={foto.driveId} />;
  return <img src={urlRecurso(baseFotos, foto.ruta)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />;
}

export function nombreFoto(foto: Foto | undefined): string {
  if (!foto) return "Foto";
  return foto.descripcion || (foto.tipo ? `Foto (${foto.tipo})` : "Foto sin clasificar");
}

interface Props {
  marca: MarcaId;
  formato: FormatoId;
  elegidas: readonly string[];
  onAlternar: (id: string) => void;
  /** Foto recién subida: se añade a la selección. */
  onSubida: (id: string) => void;
  baseFotos: string;
}

/**
 * Biblioteca de la marca (Drive y platos de la carta) para elegir de 1 a 10
 * fotos. Cada foto elegida lleva su número de orden; tocarla otra vez la
 * quita. Las que no valen salen en gris y explican por qué al tocarlas.
 */
export function BibliotecaFotos({ marca, formato, elegidas, onAlternar, onSubida, baseFotos }: Props) {
  const { fotos: todas, avisos, cargando, error, cargandoCarta, errorCarta } = useFotosInstagram(marca);
  const [origen, setOrigen] = useState<Origen>("todas");
  const [aviso, setAviso] = useState<string | null>(null);
  const [subir, setSubir] = useState(false);
  const cuantas: Record<Origen, number> = {
    todas: todas.length,
    drive: todas.filter((f) => !f.platoId).length,
    carta: todas.filter((f) => !!f.platoId).length,
  };
  const fotos = origen === "todas" ? todas : todas.filter((f) => (origen === "carta" ? !!f.platoId : !f.platoId));
  const lleno = elegidas.length >= MAX_FOTOS_CARRUSEL;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <div role="group" aria-label="De dónde salen las fotos" className="flex flex-wrap gap-1">
          {ORIGENES.map((o) => (
            <Button
              key={o.id}
              type="button"
              size="sm"
              variant={origen === o.id ? "secondary" : "ghost"}
              aria-pressed={origen === o.id}
              onClick={() => setOrigen(o.id)}
              className="h-9 px-2.5 text-xs pointer-coarse:min-h-11"
            >
              {o.nombre} ({cuantas[o.id]})
            </Button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setSubir(true)} className="h-9 shrink-0 px-2.5 pointer-coarse:min-h-11">
          <ImagePlus className="mr-1 h-4 w-4" aria-hidden="true" />
          Subir foto
        </Button>
      </div>

      {avisos.map((a) => (
        <p key={a} className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{a}</span>
        </p>
      ))}
      {(cargando || cargandoCarta) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Cargando tus fotos…
        </p>
      )}
      {error && origen !== "carta" && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          No se pueden cargar las fotos de Drive: {textoError(error)}
        </p>
      )}
      {errorCarta && origen !== "drive" && (
        <p role="alert" className="text-xs text-destructive">
          No se pueden cargar las fotos de la carta: {textoError(errorCarta)}
        </p>
      )}
      {!cargando && !cargandoCarta && fotos.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">
          {origen === "carta" ? "No hay platos activos con foto en la carta." : "Aún no hay fotos: sube la primera con «Subir foto»."}
        </p>
      )}

      <div
        role="group"
        aria-label="Biblioteca de fotos"
        className="grid max-h-[min(14rem,30vh)] grid-cols-4 gap-1.5 overflow-y-auto overscroll-contain rounded-md p-0.5 sm:grid-cols-5 lg:max-h-[min(15rem,32vh)] xl:grid-cols-6"
        data-testid="biblioteca-fotos"
      >
        {fotos.map((foto) => {
          const motivo = motivoNoApta(foto, formato);
          const orden = elegidas.indexOf(foto.id);
          const elegida = orden >= 0;
          const nombre = nombreFoto(foto);
          return (
            <button
              key={foto.id}
              type="button"
              role="checkbox"
              aria-checked={elegida}
              aria-disabled={motivo || (lleno && !elegida) ? true : undefined}
              aria-label={`${foto.platoId ? "Carta: " : ""}${nombre}${elegida ? `. Elegida, número ${orden + 1}` : ""}${motivo ? `. No sirve: ${motivo}` : ""}`}
              title={motivo ?? nombre}
              data-testid={`foto-${foto.id}`}
              onClick={() => {
                if (motivo && !elegida) return setAviso(motivo);
                if (lleno && !elegida) return setAviso(`Ya tienes ${MAX_FOTOS_CARRUSEL} fotos, el máximo de Instagram. Quita una para añadir otra.`);
                setAviso(null);
                onAlternar(foto.id);
              }}
              className={cn(
                "relative block aspect-[4/5] w-full overflow-hidden rounded-md border bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                elegida ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/60",
                motivo && !elegida && "cursor-not-allowed opacity-40 grayscale",
              )}
            >
              <MiniaturaFoto foto={foto} baseFotos={baseFotos} />
              {foto.platoId && (
                <span className="absolute bottom-1 left-1 rounded bg-primary px-1 text-xs font-medium leading-4 text-primary-foreground" aria-hidden="true">
                  Carta
                </span>
              )}
              <EtiquetaOriginal foto={foto} />
              {elegida && (
                <span
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow"
                  aria-hidden="true"
                >
                  {orden + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {aviso && (
        <p role="status" className="text-xs text-muted-foreground">
          {aviso}
        </p>
      )}

      <SubirFotoDialog
        abierto={subir}
        onAbierto={setSubir}
        marca={marca}
        onSubida={(foto) => {
          if (foto.marca !== marca) return;
          setAviso(null);
          onSubida(foto.id);
        }}
      />
    </div>
  );
}
