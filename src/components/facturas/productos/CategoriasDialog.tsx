import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGuardarCategoria } from "@/hooks/useProductosCatalogo";
import type { CategoriaProducto } from "@/lib/facturas/productos";

const RAIZ = "__raiz";

function FilaCategoria({ c, sangria }: { c: CategoriaProducto; sangria: boolean }) {
  const [nombre, setNombre] = useState(c.nombre);
  useEffect(() => setNombre(c.nombre), [c.nombre]);
  const guardar = useGuardarCategoria();
  const limpio = nombre.replace(/\s+/g, " ").trim();
  return (
    <li className={`flex items-center gap-2 py-1.5 ${sangria ? "pl-6" : ""}`}>
      <Input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        maxLength={80}
        aria-label={`Nombre de la categoría ${c.nombre}`}
        className={sangria ? "" : "font-semibold"}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={!limpio || limpio === c.nombre || guardar.isPending}
        onClick={() => guardar.mutate({ id: c.id, nombre: limpio })}
      >
        Guardar
      </Button>
      <Switch
        checked={c.activa}
        disabled={guardar.isPending}
        onCheckedChange={(v) => guardar.mutate({ id: c.id, nombre: c.nombre, activa: v })}
        aria-label={c.activa ? `Desactivar ${c.nombre}` : `Activar ${c.nombre}`}
      />
    </li>
  );
}

/**
 * Taxonomía editable: renombrar, desactivar (no se borran: los productos que
 * la usan la conservan) y añadir categorías o subcategorías (dos niveles).
 */
export function CategoriasDialog({ categorias, onCerrar }: { categorias: CategoriaProducto[]; onCerrar: () => void }) {
  const raices = useMemo(
    () => categorias.filter((c) => c.padre_id === null).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es")),
    [categorias],
  );
  const [nueva, setNueva] = useState("");
  const [padre, setPadre] = useState<string>(RAIZ);
  const guardar = useGuardarCategoria();
  const limpio = nueva.replace(/\s+/g, " ").trim();

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="flex max-h-[92dvh] max-w-xl flex-col gap-3 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Categorías de productos</DialogTitle>
          <DialogDescription>
            Dos niveles: categoría y, si hace falta, subcategoría. Desactivar una la quita de las listas, pero los productos que
            la tienen la conservan.
          </DialogDescription>
        </DialogHeader>
        <ul className="min-h-0 flex-1 overflow-y-auto pr-1">
          {raices.map((r) => (
            <li key={r.id}>
              <ul>
                <FilaCategoria c={r} sangria={false} />
                {categorias
                  .filter((h) => h.padre_id === r.id)
                  .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"))
                  .map((h) => (
                    <FilaCategoria key={h.id} c={h} sangria />
                  ))}
              </ul>
            </li>
          ))}
        </ul>
        <form
          className="flex shrink-0 flex-col gap-2 border-t pt-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!limpio) return;
            guardar.mutate(
              { nombre: limpio, padre_id: padre === RAIZ ? null : Number(padre) },
              { onSuccess: () => setNueva("") },
            );
          }}
        >
          <Input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva categoría" maxLength={80} aria-label="Nombre de la nueva categoría" />
          <Select value={padre} onValueChange={setPadre}>
            <SelectTrigger className="sm:w-56" aria-label="Dentro de">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={RAIZ}>Categoría principal</SelectItem>
              {raices.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>Dentro de {r.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={!limpio || guardar.isPending}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Añadir
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
