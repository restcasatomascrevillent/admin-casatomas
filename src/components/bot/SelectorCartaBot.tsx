import { useId } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

interface ItemCartaBot {
  id: string | number;
  nombre: string | null;
  precio_eur?: number | null;
}

interface SelectorCartaBotProps {
  /** Nombre en plural y minúsculas: "platos", "vinos". */
  tipo: string;
  seleccionados: string[];
  porCategoria: Record<string, ItemCartaBot[]>;
  loading: boolean;
  buscar: string;
  onBuscarChange: (v: string) => void;
  onToggle: (nombre: string) => void;
  canEdit: boolean;
}

// Selector compartido por platos y vinos: chips de lo elegido + buscador +
// lista con checkboxes agrupada por categoría (antes duplicado a mano).
export function SelectorCartaBot({
  tipo,
  seleccionados,
  porCategoria,
  loading,
  buscar,
  onBuscarChange,
  onToggle,
  canEdit,
}: SelectorCartaBotProps) {
  const buscarId = useId();
  const categorias = Object.entries(porCategoria);

  return (
    <div className="space-y-2">
      {seleccionados.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${tipo} seleccionados`}>
          {seleccionados.map((nombre) => (
            <li
              key={nombre}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-primary"
            >
              <span className="truncate">{nombre}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onToggle(nombre)}
                  aria-label={`Quitar ${nombre}`}
                  className="rounded-full p-0.5 hover:bg-primary/15 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={buscarId}
          type="search"
          placeholder={`Buscar ${tipo}…`}
          aria-label={`Buscar ${tipo}`}
          autoComplete="off"
          value={buscar}
          onChange={(e) => onBuscarChange(e.target.value)}
          className="h-9 pl-9"
        />
      </div>

      <div className="max-h-60 space-y-3 overflow-y-auto rounded-md border p-2">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={`Cargando ${tipo}`} />
          </div>
        ) : categorias.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No se encontraron {tipo}</p>
        ) : (
          categorias.map(([cat, items]) => (
            <div key={cat}>
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{cat}</p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const nombre = item.nombre || "";
                  return (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={seleccionados.includes(nombre)}
                        onCheckedChange={() => onToggle(nombre)}
                        disabled={!canEdit}
                      />
                      <span className="min-w-0 flex-1 text-sm">{item.nombre}</span>
                      {item.precio_eur != null && (
                        <span className="text-xs tabular-nums text-muted-foreground">{item.precio_eur.toFixed(2)} €</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
