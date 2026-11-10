import { ArrowDown, ArrowUp, Plus, Trash2, Type, Image as ImageIcon, Quote, Minus, PenLine, ListOrdered, CalendarDays, MousePointerClick, Highlighter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SelectorImagenGaleria } from "./SelectorImagenGaleria";
import { bloqueVacio, NOMBRE_BLOQUE, TIPOS_BLOQUE, MAX_BLOQUES, MAX_PLATOS, type Bloque, type TipoBloque, type PlatoBloque } from "@/lib/newsletter/diseno";

const ICONO: Record<TipoBloque, React.ReactNode> = {
  texto: <Type />,
  imagen: <ImageIcon />,
  destacado: <Highlighter />,
  platos: <ListOrdered />,
  evento: <CalendarDays />,
  boton: <MousePointerClick />,
  cita: <Quote />,
  separador: <Minus />,
  firma: <PenLine />,
};

const ENTRADA = "h-11 text-base md:text-sm";
const AREA = "text-base md:text-sm";

interface Props {
  bloques: Bloque[];
  onChange: (bloques: Bloque[]) => void;
}

/**
 * Editor de los bloques del correo: cada bloque con sus campos (texto plano,
 * nunca HTML), y botones para subir, bajar, quitar y añadir. Lo que se pinta
 * es la vista previa de al lado, con la misma función que el envío real.
 */
export function EditorBloquesNewsletter({ bloques, onChange }: Props) {
  const cambiar = (i: number, b: Bloque) => onChange(bloques.map((x, j) => (j === i ? b : x)));
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= bloques.length) return;
    const nuevo = [...bloques];
    [nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]];
    onChange(nuevo);
  };
  const quitar = (i: number) => onChange(bloques.filter((_, j) => j !== i));
  const anadir = (t: TipoBloque) => onChange([...bloques, bloqueVacio(t)]);

  return (
    <div className="space-y-3">
      <ol className="space-y-3" aria-label="Bloques del correo">
        {bloques.map((b, i) => (
          <li key={i} className="rounded-md border bg-card">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
              <span className="text-accent [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{ICONO[b.tipo]}</span>
              <span className="flex-1 text-sm font-medium">{NOMBRE_BLOQUE[b.tipo]}</span>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir el bloque ${i + 1}`}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => mover(i, 1)} disabled={i === bloques.length - 1} aria-label={`Bajar el bloque ${i + 1}`}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 hover:text-destructive" onClick={() => quitar(i)} disabled={bloques.length === 1} aria-label={`Quitar el bloque ${i + 1}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {b.tipo !== "separador" && <div className="space-y-2 p-3">{campos(b, (nb) => cambiar(i, nb), i)}</div>}
          </li>
        ))}
      </ol>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="h-11 w-full" disabled={bloques.length >= MAX_BLOQUES}>
            <Plus className="mr-2 h-4 w-4" />
            Añadir bloque
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-56">
          {TIPOS_BLOQUE.map((t) => (
            <DropdownMenuItem key={t} onSelect={() => anadir(t)} className="min-h-10 gap-2">
              <span className="text-accent [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{ICONO[t]}</span>
              {NOMBRE_BLOQUE[t]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Campo({ id, etiqueta, children }: { id: string; etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{etiqueta}</Label>
      {children}
    </div>
  );
}

function campos(b: Bloque, set: (b: Bloque) => void, i: number): React.ReactNode {
  const id = (c: string) => `bloque-${i}-${c}`;
  switch (b.tipo) {
    case "texto":
    case "firma":
      return (
        <Campo id={id("texto")} etiqueta={b.tipo === "firma" ? "Firma" : "Texto (deja una línea en blanco entre párrafos)"}>
          <Textarea id={id("texto")} value={b.texto} rows={b.tipo === "firma" ? 2 : 4} className={AREA} onChange={(e) => set({ ...b, texto: e.target.value })} />
        </Campo>
      );
    case "imagen":
      return (
        <>
          <SelectorImagenGaleria etiqueta="Foto" imagenSeleccionada={b.url || undefined} onSeleccionar={(url) => set({ ...b, url: url ?? "" })} />
          <Campo id={id("alt")} etiqueta="Qué se ve en la foto (para quien no ve imágenes)">
            <Input id={id("alt")} value={b.alt} className={ENTRADA} placeholder="Arroz meloso de bogavante" onChange={(e) => set({ ...b, alt: e.target.value })} />
          </Campo>
          <Campo id={id("pie")} etiqueta="Pie de foto (opcional)">
            <Input id={id("pie")} value={b.pie ?? ""} className={ENTRADA} onChange={(e) => set({ ...b, pie: e.target.value })} />
          </Campo>
        </>
      );
    case "destacado":
      return (
        <>
          <Campo id={id("titulo")} etiqueta="Título pequeño (opcional)">
            <Input id={id("titulo")} value={b.titulo ?? ""} className={ENTRADA} onChange={(e) => set({ ...b, titulo: e.target.value })} />
          </Campo>
          <Campo id={id("texto")} etiqueta="Texto">
            <Textarea id={id("texto")} value={b.texto} rows={3} className={AREA} onChange={(e) => set({ ...b, texto: e.target.value })} />
          </Campo>
        </>
      );
    case "platos": {
      const setPlato = (k: number, p: PlatoBloque) => set({ ...b, platos: b.platos.map((x, j) => (j === k ? p : x)) });
      return (
        <>
          <Campo id={id("titulo")} etiqueta="Título de la lista (opcional)">
            <Input id={id("titulo")} value={b.titulo ?? ""} className={ENTRADA} onChange={(e) => set({ ...b, titulo: e.target.value })} />
          </Campo>
          <ul className="space-y-2">
            {b.platos.map((p, k) => (
              <li key={k} className="space-y-2 rounded-md border border-dashed p-2">
                <div className="flex gap-2">
                  <Input aria-label={`Plato ${k + 1}: nombre`} placeholder="Nombre del plato" value={p.nombre} className={`${ENTRADA} min-w-0 flex-1`} onChange={(e) => setPlato(k, { ...p, nombre: e.target.value })} />
                  <Input aria-label={`Plato ${k + 1}: precio`} placeholder="Precio" value={p.precio ?? ""} className={`${ENTRADA} w-24 shrink-0`} onChange={(e) => setPlato(k, { ...p, precio: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 hover:text-destructive" disabled={b.platos.length === 1}
                    onClick={() => set({ ...b, platos: b.platos.filter((_, j) => j !== k) })} aria-label={`Quitar el plato ${k + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input aria-label={`Plato ${k + 1}: descripción`} placeholder="Descripción corta (opcional)" value={p.descripcion ?? ""} className={ENTRADA} onChange={(e) => setPlato(k, { ...p, descripcion: e.target.value })} />
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" className="h-10" disabled={b.platos.length >= MAX_PLATOS} onClick={() => set({ ...b, platos: [...b.platos, { nombre: "" }] })}>
            <Plus className="mr-1 h-4 w-4" /> Añadir plato
          </Button>
        </>
      );
    }
    case "evento":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {(["fecha", "hora", "lugar", "precio"] as const).map((k) => (
            <Campo key={k} id={id(k)} etiqueta={k[0].toUpperCase() + k.slice(1)}>
              <Input id={id(k)} value={b[k] ?? ""} className={ENTRADA} onChange={(e) => set({ ...b, [k]: e.target.value })} />
            </Campo>
          ))}
        </div>
      );
    case "boton":
      return (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Campo id={id("texto")} etiqueta="Texto del botón">
            <Input id={id("texto")} value={b.texto} maxLength={40} className={ENTRADA} onChange={(e) => set({ ...b, texto: e.target.value })} />
          </Campo>
          <Campo id={id("url")} etiqueta="Enlace (https://…)">
            <Input id={id("url")} value={b.url} inputMode="url" className={ENTRADA} onChange={(e) => set({ ...b, url: e.target.value })} />
          </Campo>
        </div>
      );
    case "cita":
      return (
        <>
          <Campo id={id("texto")} etiqueta="Cita">
            <Textarea id={id("texto")} value={b.texto} rows={2} className={AREA} onChange={(e) => set({ ...b, texto: e.target.value })} />
          </Campo>
          <Campo id={id("autor")} etiqueta="Autor (opcional)">
            <Input id={id("autor")} value={b.autor ?? ""} className={ENTRADA} onChange={(e) => set({ ...b, autor: e.target.value })} />
          </Campo>
        </>
      );
    case "separador":
      return null;
  }
}
