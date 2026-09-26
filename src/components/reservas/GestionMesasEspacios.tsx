// ============================================================================
// MESAS Y AFORO POR ESPACIO — pestaña Configuración de /reservas
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-09-26):
//   "En la configuración habrá que meter la capacidad de cada espacio y las
//    mesas que hay. Hacer la regla para ver si luego podemos usar la parte del
//    gestor de espacios para asociar las mesas."
//   Y sobre qué cifra manda:
//   "Que mande la suma de las mesas; para eso lo dejamos cableado, y de
//    momento seguimos con la capacidad total."
//
// Esta pantalla hace DOS cosas y deliberadamente ninguna más:
//
//   1. Vía rápida para dar de alta / editar / borrar las mesas de cada espacio
//      (nombre, etiqueta, plazas y forma). NO se colocan posiciones aquí: para
//      eso está el editor de plano (Super Admin › Espacios › "Configurar Plano
//      y Mesas"). Las mesas nuevas se crean con los valores por defecto de la
//      tabla y quedan a la espera de que alguien las coloque en el plano.
//
//   2. Enseña, por espacio, la CAPACIDAD DECLARADA (`capacidad_maxima`) frente
//      a la SUMA DE PLAZAS de sus mesas activas, y avisa cuando no cuadran.
//
// IMPORTANTE — es información, NO un bloqueo. Un espacio descuadrado se puede
// guardar igual y se puede seguir reservando: hoy el aforo lo decide
// `capacidad_maxima` a través del trigger `trg_validar_capacidad`, que no se ha
// tocado. La regla de "que mande la suma de las mesas" está escrita y lista en
// `supabase/migrations/20260926120000_capacidad_efectiva_mesas.sql`, pero
// DORMIDA (ni aplicada ni enchufada al trigger). Ahí está documentado qué hay
// que cambiar para encenderla.
//
// Las cuentas NO se hacen aquí: viven en `src/lib/reservas/aforoMesas.ts`, que
// replica exactamente el filtro del trigger (espacios activos + misma marca).
// ============================================================================

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Check,
  Circle,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  RectangleHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useMesas,
  useCrearMesa,
  useActualizarMesa,
  useEliminarMesa,
  type Mesa,
} from "@/hooks/useMesas";
import { useEspaciosReserva, type EspacioReserva } from "@/hooks/useEspaciosReserva";
import {
  calcularCuadrePorNegocio,
  calcularCuadres,
  textoEstadoCuadre,
  type CuadreEspacio,
  type CuadreNegocio,
} from "@/lib/reservas/aforoMesas";
import { agruparPorNegocio } from "@/lib/reservas/negocios";
import { NegocioBadge } from "./NegocioBadge";

// ── Formas que el plano sabe dibujar ────────────────────────────────────────
// `CanvasPlano` solo distingue `forma === "circular"` de todo lo demás, así que
// no se ofrecen formas que luego se pintarían como un rectángulo cualquiera.
const FORMAS = [
  { valor: "rectangular", etiqueta: "Rectangular" },
  { valor: "circular", etiqueta: "Redonda" },
] as const;

type FormaMesa = (typeof FORMAS)[number]["valor"];

const CAPACIDAD_MIN = 1;
const CAPACIDAD_MAX = 50;

interface BorradorMesa {
  nombre: string;
  etiqueta: string;
  capacidad: number;
  forma: FormaMesa;
  activa: boolean;
}

const borradorVacio = (): BorradorMesa => ({
  nombre: "",
  etiqueta: "",
  capacidad: 4,
  forma: "rectangular",
  activa: true,
});

const borradorDeMesa = (mesa: Mesa): BorradorMesa => ({
  nombre: mesa.nombre ?? "",
  etiqueta: mesa.etiqueta ?? "",
  capacidad: Number.isFinite(Number(mesa.capacidad)) ? Number(mesa.capacidad) : 0,
  forma: mesa.forma === "circular" ? "circular" : "rectangular",
  activa: mesa.activa !== false,
});

const plural = (n: number, singular: string, plural_: string) =>
  `${n} ${n === 1 ? singular : plural_}`;

// ── Insignia de cuadre ──────────────────────────────────────────────────────

function BadgeCuadre({ cuadre }: { cuadre: CuadreEspacio }) {
  if (cuadre.estado === "cuadra") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
      >
        <Check className="h-3 w-3" aria-hidden="true" />
        Cuadra
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {cuadre.estado === "sin_mesas" ? "Sin mesas" : "No cuadra"}
    </Badge>
  );
}

// ── Diálogo de alta / edición de una mesa ───────────────────────────────────

interface DialogoMesaProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  espacioNombre: string;
  /** Mesa a editar; `null` = alta nueva. */
  mesa: Mesa | null;
  guardando: boolean;
  onGuardar: (borrador: BorradorMesa) => Promise<void>;
}

function DialogoMesa({
  abierto,
  onAbiertoChange,
  espacioNombre,
  mesa,
  guardando,
  onGuardar,
}: DialogoMesaProps) {
  // Quien lo usa lo monta y desmonta con cada apertura (`{dialogo && ...}`), así
  // que el borrador arranca limpio en cada alta y con los datos de la mesa en
  // cada edición: no hace falta resincronizar nada.
  const [borrador, setBorrador] = useState<BorradorMesa>(() =>
    mesa ? borradorDeMesa(mesa) : borradorVacio(),
  );
  const [tocado, setTocado] = useState(false);

  const nombreVacio = borrador.nombre.trim().length === 0;
  const capacidadInvalida =
    !Number.isInteger(borrador.capacidad) ||
    borrador.capacidad < CAPACIDAD_MIN ||
    borrador.capacidad > CAPACIDAD_MAX;

  const enviar = async () => {
    setTocado(true);
    if (nombreVacio || capacidadInvalida) return;
    await onGuardar({ ...borrador, nombre: borrador.nombre.trim(), etiqueta: borrador.etiqueta.trim() });
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{mesa ? "Editar mesa" : "Nueva mesa"}</DialogTitle>
          <DialogDescription>
            {espacioNombre}. La posición en el plano se ajusta en Espacios ›
            Configurar Plano y Mesas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mesa-nombre">Nombre</Label>
            <Input
              id="mesa-nombre"
              value={borrador.nombre}
              placeholder="Ej: Mesa 1"
              aria-invalid={tocado && nombreVacio}
              onChange={(e) => setBorrador((b) => ({ ...b, nombre: e.target.value }))}
            />
            {tocado && nombreVacio && (
              <p className="text-sm text-destructive">Ponle un nombre a la mesa.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mesa-etiqueta">Etiqueta (opcional)</Label>
            <Input
              id="mesa-etiqueta"
              value={borrador.etiqueta}
              placeholder="Ej: Junto a la ventana"
              onChange={(e) => setBorrador((b) => ({ ...b, etiqueta: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mesa-capacidad">Plazas</Label>
              <Input
                id="mesa-capacidad"
                type="number"
                inputMode="numeric"
                min={CAPACIDAD_MIN}
                max={CAPACIDAD_MAX}
                value={Number.isFinite(borrador.capacidad) ? borrador.capacidad : ""}
                aria-invalid={tocado && capacidadInvalida}
                onChange={(e) =>
                  setBorrador((b) => ({ ...b, capacidad: parseInt(e.target.value, 10) }))
                }
              />
              {tocado && capacidadInvalida && (
                <p className="text-sm text-destructive">
                  Entre {CAPACIDAD_MIN} y {CAPACIDAD_MAX} plazas.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="mesa-forma">Forma</Label>
              <Select
                value={borrador.forma}
                onValueChange={(v) => setBorrador((b) => ({ ...b, forma: v as FormaMesa }))}
              >
                <SelectTrigger id="mesa-forma">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAS.map((f) => (
                    <SelectItem key={f.valor} value={f.valor}>
                      {f.etiqueta}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="mesa-activa">Mesa en uso</Label>
              <p className="text-sm text-muted-foreground">
                Las mesas desactivadas no suman plazas ni salen en el plano.
              </p>
            </div>
            <Switch
              id="mesa-activa"
              checked={borrador.activa}
              onCheckedChange={(v) => setBorrador((b) => ({ ...b, activa: v }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onAbiertoChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={enviar} disabled={guardando}>
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {mesa ? "Guardar cambios" : "Crear mesa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bloque de un espacio ────────────────────────────────────────────────────

interface BloqueEspacioProps {
  cuadre: CuadreEspacio;
  mesas: Mesa[];
  onNueva: () => void;
  onEditar: (mesa: Mesa) => void;
  onBorrar: (mesa: Mesa) => void;
}

function BloqueEspacio({ cuadre, mesas, onNueva, onEditar, onBorrar }: BloqueEspacioProps) {
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium">{cuadre.nombre}</span>
          {!cuadre.activa && (
            <Badge variant="outline" className="text-muted-foreground">
              Desactivado
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Declarada{" "}
            <strong className="text-foreground tabular-nums">{cuadre.capacidadDeclarada}</strong>
          </span>
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="text-muted-foreground">
            {plural(cuadre.mesasActivas, "mesa", "mesas")} ={" "}
            <strong className="text-foreground tabular-nums">{cuadre.plazasMesas}</strong> plazas
          </span>
          <BadgeCuadre cuadre={cuadre} />
        </div>
      </div>

      {cuadre.descuadra && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {textoEstadoCuadre(cuadre)}. No impide reservar: hoy el aforo lo marca la
            capacidad declarada.
          </span>
        </p>
      )}

      {mesas.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {mesas.map((mesa) => {
            const inactiva = mesa.activa === false;
            return (
              <li
                key={mesa.id}
                className={cn(
                  "flex items-center justify-between gap-2 px-3 py-2 text-sm",
                  inactiva && "opacity-60",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {mesa.forma === "circular" ? (
                    <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <RectangleHorizontal
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate font-medium">{mesa.nombre}</span>
                  {mesa.etiqueta && (
                    <span className="truncate text-muted-foreground">· {mesa.etiqueta}</span>
                  )}
                  {mesa.is_merged && (
                    <Badge variant="outline" className="shrink-0 text-muted-foreground">
                      Unida
                    </Badge>
                  )}
                  {inactiva && (
                    <Badge variant="outline" className="shrink-0 text-muted-foreground">
                      Sin usar
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="tabular-nums text-muted-foreground">
                    {plural(Number(mesa.capacidad) || 0, "plaza", "plazas")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Editar ${mesa.nombre}`}
                    onClick={() => onEditar(mesa)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    aria-label={`Borrar ${mesa.nombre}`}
                    onClick={() => onBorrar(mesa)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Este espacio no tiene mesas dadas de alta.
        </p>
      )}

      <Button type="button" variant="outline" size="sm" onClick={onNueva}>
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        Añadir mesa
      </Button>
    </div>
  );
}

// ── Resumen por negocio ─────────────────────────────────────────────────────

function ResumenNegocio({ resumen }: { resumen: CuadreNegocio }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
        Aforo declarado{" "}
        <strong className="text-foreground tabular-nums">{resumen.capacidadDeclarada}</strong>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        sumando mesas{" "}
        <strong className="text-foreground tabular-nums">{resumen.plazasMesas}</strong>
      </span>
      {resumen.bloquearia && (
        <Badge
          variant="outline"
          className="gap-1 border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
        >
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Sin mesas en ninguna sala
        </Badge>
      )}
    </span>
  );
}

// ── Pantalla ────────────────────────────────────────────────────────────────

export function GestionMesasEspacios() {
  const { data: espaciosData, isLoading: cargandoEspacios } = useEspaciosReserva();
  const { data: mesas = [], isLoading: cargandoMesas } = useMesas(undefined, {
    incluirInactivas: true,
  });

  const crearMesa = useCrearMesa();
  const actualizarMesa = useActualizarMesa();
  const eliminarMesa = useEliminarMesa();

  const [dialogo, setDialogo] = useState<{ espacio: CuadreEspacio; mesa: Mesa | null } | null>(null);
  const [aBorrar, setABorrar] = useState<Mesa | null>(null);

  const espacios = useMemo(
    () => ((espaciosData ?? []) as EspacioReserva[]).filter(Boolean),
    [espaciosData],
  );

  const cuadres = useMemo(() => calcularCuadres(espacios, mesas), [espacios, mesas]);
  const grupos = useMemo(() => agruparPorNegocio(cuadres, (c) => c.marca), [cuadres]);
  const resumenPorMarca = useMemo(() => {
    const mapa = new Map<string, CuadreNegocio>();
    for (const r of calcularCuadrePorNegocio(cuadres)) mapa.set(r.marca, r);
    return mapa;
  }, [cuadres]);

  const mesasDeEspacio = (espacioId: string) =>
    mesas.filter((m) => m.espacio_id === espacioId);

  const guardarMesa = async (borrador: BorradorMesa) => {
    if (!dialogo) return;
    const { espacio, mesa } = dialogo;
    try {
      if (mesa) {
        await actualizarMesa.mutateAsync({
          id: mesa.id,
          nombre: borrador.nombre,
          etiqueta: borrador.etiqueta || null,
          capacidad: borrador.capacidad,
          forma: borrador.forma,
          activa: borrador.activa,
        });
        toast.success("Mesa actualizada");
      } else {
        // No se envían `pos_x`/`pos_y`/`ancho`/`alto` a propósito: se dejan los
        // valores por defecto de la tabla. Las posiciones se colocan en el
        // editor de plano, que es quien conoce la escala de cada espacio.
        await crearMesa.mutateAsync({
          espacio_id: espacio.espacioId,
          nombre: borrador.nombre,
          etiqueta: borrador.etiqueta || null,
          capacidad: borrador.capacidad,
          forma: borrador.forma,
          activa: borrador.activa,
        });
        toast.success("Mesa creada");
      }
      setDialogo(null);
    } catch {
      // Los hooks ya avisan con un toast de error.
    }
  };

  const confirmarBorrado = async () => {
    if (!aBorrar) return;
    try {
      await eliminarMesa.mutateAsync(aBorrar.id);
    } finally {
      setABorrar(null);
    }
  };

  if (cargandoEspacios || cargandoMesas) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Cargando" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle className="text-lg">Mesas y aforo por espacio</CardTitle>
        </div>
        <CardDescription>
          Da de alta las mesas de cada sala y comprueba si la capacidad declarada
          cuadra con las plazas que suman sus mesas
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {espacios.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay espacios de reserva dados de alta.
          </p>
        ) : (
          grupos.map(({ negocio, items }) => (
            <section key={negocio.marca} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <NegocioBadge marca={negocio.marca} />
                {resumenPorMarca.has(negocio.marca) && (
                  <ResumenNegocio resumen={resumenPorMarca.get(negocio.marca)!} />
                )}
              </div>
              <div className="space-y-3">
                {items.map((cuadre) => (
                  <BloqueEspacio
                    key={cuadre.espacioId}
                    cuadre={cuadre}
                    mesas={mesasDeEspacio(cuadre.espacioId)}
                    onNueva={() => setDialogo({ espacio: cuadre, mesa: null })}
                    onEditar={(mesa) => setDialogo({ espacio: cuadre, mesa })}
                    onBorrar={(mesa) => setABorrar(mesa)}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        <Separator />

        <p className="text-sm text-muted-foreground">
          Hoy el aforo lo decide la <strong className="text-foreground">capacidad declarada</strong>{" "}
          de cada espacio; la suma de las mesas es solo informativa. Los avisos de arriba no
          impiden guardar ni reservar.
        </p>
      </CardContent>

      {dialogo && (
        <DialogoMesa
          abierto
          onAbiertoChange={(abierto) => {
            if (!abierto) setDialogo(null);
          }}
          espacioNombre={dialogo.espacio.nombre}
          mesa={dialogo.mesa}
          guardando={crearMesa.isPending || actualizarMesa.isPending}
          onGuardar={guardarMesa}
        />
      )}

      <AlertDialog open={!!aBorrar} onOpenChange={(abierto) => !abierto && setABorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la mesa {aBorrar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se quita del plano y deja de sumar plazas. No se puede deshacer. Si solo quieres
              dejar de usarla temporalmente, edítala y desactiva "Mesa en uso".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarBorrado}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Borrar mesa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
