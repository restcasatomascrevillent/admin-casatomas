/**
 * «Elegir de la carta»: hoja a pantalla completa con las fotos de los platos
 * de la marca. Se marcan varias (hasta los huecos libres) y «Añadir».
 */
import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MarcaId } from "@/lib/instagram";
import type { PlatoCarta } from "./servicios";

interface Props {
  marca: MarcaId;
  maximo: number;
  listar: (marca: MarcaId) => Promise<PlatoCarta[]>;
  onCerrar: () => void;
  onElegir: (platos: PlatoCarta[]) => void;
}

export function ElegirCarta({ marca, maximo, listar, onCerrar, onElegir }: Props) {
  const [platos, setPlatos] = useState<PlatoCarta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);

  useEffect(() => {
    let vivo = true;
    setPlatos(null);
    setError(null);
    listar(marca)
      .then((p) => vivo && setPlatos(p))
      .catch((e) => vivo && setError((e as Error)?.message || "No se ha podido cargar la carta"));
    return () => {
      vivo = false;
    };
  }, [marca, listar]);

  const alternar = (id: string) =>
    setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : m.length >= maximo ? m : [...m, id]));

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="titulo-carta-movil" className="fixed inset-0 z-[60] flex flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon" className="h-12 w-12" onClick={onCerrar} aria-label="Cerrar sin elegir">
          <X className="h-6 w-6" aria-hidden="true" />
        </Button>
        <h2 id="titulo-carta-movil" className="text-lg font-semibold">
          Elegir de la carta
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : !platos ? (
          <p className="flex items-center gap-2 p-3 text-base text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Cargando la carta…
          </p>
        ) : platos.length === 0 ? (
          <p className="p-3 text-base text-muted-foreground">No hay platos con foto en la carta de esta marca.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {platos.map((p) => {
              const marcado = marcados.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => alternar(p.id)}
                    aria-pressed={marcado}
                    className={cn("relative block w-full overflow-hidden rounded-lg border text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", marcado && "ring-4 ring-primary")}
                  >
                    <img src={p.url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                    <span className="block truncate px-2 py-2 text-sm font-medium">{p.nombre}</span>
                    {marcado && (
                      <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          className="h-14 w-full text-base"
          disabled={!marcados.length}
          onClick={() => onElegir((platos ?? []).filter((p) => marcados.includes(p.id)).sort((a, b) => marcados.indexOf(a.id) - marcados.indexOf(b.id)))}
        >
          {marcados.length ? `Añadir ${marcados.length === 1 ? "1 foto" : `${marcados.length} fotos`}` : `Marca hasta ${maximo === 1 ? "1 foto" : `${maximo} fotos`}`}
        </Button>
      </footer>
    </div>
  );
}
