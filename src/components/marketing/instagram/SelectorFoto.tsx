import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FORMATOS,
  escalaParaCubrir,
  esAptaPara,
  fotosDe,
  urlRecurso,
  type Foto,
  type FormatoId,
  type MarcaId,
  type Plantilla,
} from "@/lib/instagram";

const NOMBRE_FORMATO: Record<FormatoId, string> = { post: "un post", story: "una story" };

/** Por qué una foto no se puede usar (o null si se puede). Misma regla que validarPieza. */
export function motivoNoApta(foto: Foto, formato: FormatoId, plantilla?: Pick<Plantilla, "tiposFoto">): string | null {
  if (plantilla?.tiposFoto?.length && !plantilla.tiposFoto.includes(foto.tipo)) {
    return `Esta plantilla no usa fotos de tipo «${foto.tipo}».`;
  }
  if (!esAptaPara(foto, formato)) {
    const f = FORMATOS[formato];
    const ampliar = Math.round((escalaParaCubrir(foto.ancho, foto.alto, f.ancho, f.alto) - 1) * 100);
    const forma = foto.ancho > foto.alto ? "Es apaisada" : "Es pequeña";
    return `${forma} (${foto.ancho}×${foto.alto}): para ${NOMBRE_FORMATO[formato]} habría que ampliarla un ${ampliar} % y se vería borrosa.`;
  }
  return null;
}

interface Props {
  marca: MarcaId;
  formato: FormatoId;
  plantilla?: Plantilla;
  valor: string;
  onCambio: (id: string) => void;
  baseFotos: string;
  conProblema?: boolean;
}

export function SelectorFoto({ marca, formato, plantilla, valor, onCambio, baseFotos, conProblema }: Props) {
  const fotos = fotosDe(marca);
  // En el móvil no hay «title» al pasar el ratón: al tocar una foto que no vale se explica debajo.
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <fieldset className={cn("rounded-md", conProblema && "ring-2 ring-destructive ring-offset-2")} aria-describedby="ayuda-foto">
      <legend className="text-sm font-medium">Foto</legend>
      <p id="ayuda-foto" className="mb-2 text-xs text-muted-foreground">
        Las fotos en gris no sirven para este formato o plantilla: tócalas para ver por qué.
      </p>
      <div role="radiogroup" aria-label="Foto" className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-4">
        {fotos.map((foto) => {
          const motivo = motivoNoApta(foto, formato, plantilla);
          const elegida = valor === foto.id;
          return (
            <button
              key={foto.id}
              type="button"
              role="radio"
              aria-checked={elegida}
              aria-disabled={motivo ? true : undefined}
              title={motivo ?? foto.descripcion}
              aria-label={`${foto.descripcion}${motivo ? ` No disponible: ${motivo}` : ""}`}
              data-testid={`foto-${foto.id}`}
              // aria-disabled (no `disabled`): sigue siendo enfocable y el lector de pantalla lee el motivo.
              onClick={() => {
                if (motivo) return setAviso(motivo);
                setAviso(null);
                onCambio(foto.id);
              }}
              className={cn(
                "relative aspect-[4/5] overflow-hidden rounded-md border bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                elegida ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/60",
                motivo && "cursor-not-allowed opacity-40 grayscale",
              )}
            >
              <img
                src={urlRecurso(baseFotos, foto.ruta)}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              {elegida && (
                <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground" aria-hidden="true">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {aviso && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {aviso}
        </p>
      )}
      {valor && (() => {
        const elegida = fotos.find((f) => f.id === valor);
        const motivo = elegida ? motivoNoApta(elegida, formato, plantilla) : null;
        return motivo ? <p className="mt-1 text-xs text-destructive">La foto elegida no vale: {motivo}</p> : null;
      })()}
    </fieldset>
  );
}
