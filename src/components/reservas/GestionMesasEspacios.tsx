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
// DECISIÓN DEL DUEÑO (2026-09-26, revisión): las mesas se crean, editan y
// borran ÚNICAMENTE en el editor de plano (Super Admin › Espacios ›
// "Configurar Plano y Mesas": `src/pages/Espacios.tsx` →
// `EditorPlanoEspacio.tsx`). Esta pantalla dejó de tener altas/edición/borrado
// de mesas porque tener DOS sitios que las tocan se saltaba las salvaguardas
// del editor (repuntar `asignaciones_mesa` antes de borrar originales
// fusionadas, avisar con el recuento de reservas, exigir nombres únicos por
// espacio) y creaba mesas sin posición en el plano — en producción hay dos
// mesas "9" en el Salón por este motivo exacto.
//
// Esta pantalla ahora hace SOLO UNA cosa: enseña, por espacio, la CAPACIDAD
// DECLARADA (`capacidad_maxima`) frente a la SUMA DE PLAZAS de sus mesas
// activas, avisa cuando no cuadran, y ofrece un acceso directo al editor de
// plano de cada espacio para quien pueda usarlo.
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

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Check,
  Circle,
  LayoutGrid,
  Loader2,
  MapPinned,
  RectangleHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMesas, type Mesa } from "@/hooks/useMesas";
import { useEspaciosReserva, type EspacioReserva } from "@/hooks/useEspaciosReserva";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import {
  calcularCuadrePorNegocio,
  calcularCuadres,
  textoEstadoCuadre,
  type CuadreEspacio,
  type CuadreNegocio,
} from "@/lib/reservas/aforoMesas";
import { agruparPorNegocio } from "@/lib/reservas/negocios";
import { NegocioBadge } from "./NegocioBadge";

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

// ── Bloque de un espacio ────────────────────────────────────────────────────

interface BloqueEspacioProps {
  cuadre: CuadreEspacio;
  mesas: Mesa[];
  puedeAbrirPlano: boolean;
  onAbrirPlano: () => void;
}

function BloqueEspacio({ cuadre, mesas, puedeAbrirPlano, onAbrirPlano }: BloqueEspacioProps) {
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

      {puedeAbrirPlano ? (
        <Button type="button" variant="outline" size="sm" onClick={onAbrirPlano}>
          <MapPinned className="mr-2 h-4 w-4" aria-hidden="true" />
          Editar mesas en el plano
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Las mesas se gestionan en el plano (Super Admin → Espacios).
        </p>
      )}
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
  const navigate = useNavigate();
  const { data: espaciosData, isLoading: cargandoEspacios } = useEspaciosReserva();
  const { data: mesas = [], isLoading: cargandoMesas } = useMesas(undefined, {
    incluirInactivas: true,
  });
  // El editor de plano vive en Super Admin › Espacios: solo quien puede
  // entrar ahí (`SuperAdminRoute`, mismo criterio que `useSuperAdmin`) ve el
  // botón que lleva allí. El resto ve una nota indicando dónde se gestionan
  // las mesas, en vez de un botón que le llevaría a un login.
  const { isSuperAdmin, loading: cargandoPermiso } = useSuperAdmin();

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

  const abrirPlano = (espacioId: string) => {
    navigate(`/super-admin/espacios?editar=${espacioId}`);
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
          Comprueba si la capacidad declarada de cada sala cuadra con las plazas que
          suman sus mesas. Las mesas se dan de alta, editan y borran en el plano
          (Super Admin → Espacios → "Configurar Plano y Mesas").
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
                    puedeAbrirPlano={!cargandoPermiso && isSuperAdmin}
                    onAbrirPlano={() => abrirPlano(cuadre.espacioId)}
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
    </Card>
  );
}
