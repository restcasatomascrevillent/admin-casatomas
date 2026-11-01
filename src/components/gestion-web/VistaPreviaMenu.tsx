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
//
// Los rótulos son los de la web, no los del editor (`rotuloEnLaWeb`): sin
// entrante la web llama «Entrantes» al primero y «Principales» al segundo; con
// entrante, «Entrantes», «Primeros» y «Segundos». El postre sale como lo diga
// «¿Qué entra?» (Postre, Postre o café, Postre y café).
// ---------------------------------------------------------------------------

import { useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import { etiquetaAlergeno } from "@/lib/alergenos";
import {
  SECCIONES_MENU_DIA,
  completarSecciones,
  menuTieneContenido,
  rotuloEnLaWeb,
  type EntradaSeccionesMenu,
  type ItemMenu,
  type PostreCafe,
} from "@/lib/menu-dia";

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
        <p className="text-sm leading-snug break-words">{item.nombre}</p>
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
  secciones: EntradaSeccionesMenu;
  /** Qué entra en el postre; sin él (o `null`), «Postre» como siempre. */
  postreCafe?: PostreCafe | null;
}

export function VistaPreviaMenu({ secciones: entrada, postreCafe = null }: VistaPreviaMenuProps) {
  const secciones = completarSecciones(entrada);

  if (!menuTieneContenido(secciones)) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <UtensilsCrossed className="w-7 h-7 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Añade platos para verlos aquí.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {SECCIONES_MENU_DIA.map((seccion) => {
        const items = secciones[seccion];
        // El entrante es opcional: vacío no sale en la web, tampoco aquí.
        if (seccion === "entrante" && items.length === 0) return null;
        return (
          <div key={seccion} className="space-y-2" data-testid={`previa-${seccion}`}>
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground shrink-0">
                {rotuloEnLaWeb(seccion, secciones, postreCafe)}
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
