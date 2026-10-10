import { useState } from "react";
import { Package, Pencil, Power, Star, Trash2 } from "lucide-react";
import { FilaPlana } from "@/components/panel/ListaPlana";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface FilaProductoVentaProps {
  nombre: string;
  /** «bebida» o «comida»: solo para el texto de la confirmación de borrado. */
  tipo: "bebida" | "comida";
  imagenUrl: string | null;
  /** Texto gris bajo el nombre (categoría, stock, coste…); se une con « · ». */
  detalles: Array<string | false | null | undefined>;
  precio: string;
  activo: boolean;
  destacado: boolean;
  /** Stock bajo (≤ 5 uds): el estado se pinta en ámbar. */
  stockBajo?: boolean;
  onEditar: () => void;
  onCambiarActivo: (activo: boolean) => void;
  onCambiarDestacado: (destacado: boolean) => void;
  onEliminar: () => void;
}

/** Fila de producto del ecommerce: miniatura, nombre, detalles, precio, estado con punto y menú «⋯». */
export function FilaProductoVenta({
  nombre,
  tipo,
  imagenUrl,
  detalles,
  precio,
  activo,
  destacado,
  stockBajo,
  onEditar,
  onCambiarActivo,
  onCambiarDestacado,
  onEliminar,
}: FilaProductoVentaProps) {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <>
      <FilaPlana
        className={activo ? undefined : "opacity-60"}
        inicio={
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {imagenUrl ? (
              <img src={imagenUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <Package className="h-5 w-5 text-muted-foreground/50" aria-hidden="true" />
            )}
          </span>
        }
        titulo={
          <>
            {nombre}
            {destacado && <Star aria-label="Destacado" className="ml-1.5 inline h-3.5 w-3.5 -translate-y-px fill-amber-500 text-amber-500" />}
          </>
        }
        subtitulo={detalles}
        derecha={precio}
        estado={{ texto: activo ? (stockBajo ? "Poco stock" : "Activo") : "Desactivado", tono: !activo ? "gris" : stockBajo ? "ambar" : "verde" }}
        etiquetaMenu={`Más acciones de ${nombre}`}
        menu={[
          { etiqueta: "Editar", icono: Pencil, onClick: onEditar },
          { etiqueta: activo ? "Desactivar" : "Activar", icono: Power, onClick: () => onCambiarActivo(!activo) },
          { etiqueta: destacado ? "Quitar destacado" : "Destacar", icono: Star, onClick: () => onCambiarDestacado(!destacado) },
          { etiqueta: "Eliminar", icono: Trash2, destructiva: true, separadorAntes: true, onClick: () => setConfirmando(true) },
        ]}
      />
      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {tipo}?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción eliminará "{nombre}" permanentemente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onEliminar} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
