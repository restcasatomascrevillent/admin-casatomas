// ---------------------------------------------------------------------------
// Vista previa del menú del día tal y como se leerá en casa-tomas-story.
//
// Imita el lenguaje visual de la web (serif, filete dorado, papel) para que lo
// que se ve al editar se parezca a lo publicado. No pretende ser idéntica: es
// orientativa, y así se dice debajo.
//
// Los alérgenos aparecen DISCRETOS, igual que en la web: el dueño los quiere
// disponibles para quien los busque, no en primer plano. Aquí se resumen en una
// línea fina bajo el plato, y el detalle completo está en el editor.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import { etiquetaAlergeno } from "@/lib/alergenos";
import { ETIQUETA_SECCION, SECCIONES_MENU, type ItemMenu, type SeccionMenu } from "@/lib/menu-dia";

/** Foto del plato en la vista previa, con el mismo encuadre que usará la web. */
function FotoPlato({ item }: { item: ItemMenu }) {
  const [falló, setFalló] = useState(false);
  if (!item.imagenUrl || falló) return null;

  return (
    <img
      src={item.imagenUrl}
      alt=""
      loading="lazy"
      onError={() => setFalló(true)}
      className="h-12 w-12 shrink-0 rounded-sm object-cover"
      style={{ objectPosition: `50% ${item.imagenPosicionY ?? 50}%` }}
    />
  );
}

function LineaPrevia({ item }: { item: ItemMenu }) {
  const alergenos = [...item.alergenos, ...item.alergenosInferidos];

  return (
    <li className="flex items-start gap-2.5">
      <FotoPlato item={item} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{item.nombre}</p>
        {item.descripcion && (
          <p className="text-xs text-muted-foreground leading-snug mt-0.5 line-clamp-2">{item.descripcion}</p>
        )}
        {alergenos.length > 0 && (
          <p className="text-[11px] text-muted-foreground/80 mt-1">
            {alergenos.map((a) => etiquetaAlergeno(a)).join(" · ")}
          </p>
        )}
      </div>
    </li>
  );
}

interface VistaPreviaMenuProps {
  secciones: Record<SeccionMenu, ItemMenu[]>;
}

export function VistaPreviaMenu({ secciones }: VistaPreviaMenuProps) {
  const vacio = SECCIONES_MENU.every((s) => secciones[s].length === 0);

  if (vacio) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <UtensilsCrossed className="w-7 h-7 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Añade platos para verlos aquí.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {SECCIONES_MENU.map((seccion) => {
        const items = secciones[seccion];
        return (
          <div key={seccion} className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground shrink-0">
                {ETIQUETA_SECCION[seccion]}
              </p>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>
            {items.length > 0 ? (
              <ul className="space-y-2.5">
                {items.map((item) => (
                  <LineaPrevia key={item.id} item={item} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground/70 italic">—</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
