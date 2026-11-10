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
// ENCARGO NUEVO DEL DUEÑO (2026-09-27), que CAMBIA la decisión del 26:
//   "damos de alta las mesas que faltan, y que se puedan dar de alta desde el
//    sistema de generación de mesas y espacios, y que se pueda asociar un
//    número de mesa como en la realidad, así sí que funciona bien"
//
// En sala el personal dice "la 7". Si el número del sistema no coincide con el
// de la mesa de verdad, el plano no sirve para nada: el NÚMERO es el dato
// importante y tiene que ser fiable. Por eso esta pantalla ya NO es de solo
// lectura: el número se puede corregir aquí, en el mismo sitio donde el dueño
// está mirando el descuadre.
//
// QUÉ SE PUEDE Y QUÉ NO (el alcance es estrecho a propósito):
//   · SÍ: renombrar el número de una mesa real, con aviso en vivo si ya existe
//     en ese espacio y sin dejar guardar el duplicado.
//   · NO: crear ni borrar mesas. Eso sigue siendo del editor de plano (Super
//     Admin › Espacios › "Configurar Plano y Mesas":
//     `src/pages/Espacios.tsx` → `EditorPlanoEspacio.tsx`), que es el único que
//     sabe repuntar `asignaciones_mesa` antes de borrar, avisar con el recuento
//     de reservas y colocar la mesa en el plano. Tener dos sitios que CREAN
//     mesas es justo lo que dejó dos mesas "9" en el Salón. Renombrar no toca
//     ninguna de esas salvaguardas.
//   · NO se edita el número de una mesa UNIDA: su nombre es compuesto
//     ("11+10") y lo genera el editor a partir de las mesas que la forman.
//
// NÚMERO ÚNICO: no hay columna `numero`; el número vive en `mesas.nombre` (un
// `text`: "1", "9", "17", "2+1"). La garantía real es el índice único parcial
// `uq_mesas_espacio_nombre_real` sobre
// `(espacio_id, lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g')))` con
// `where coalesce(is_merged, false) = false and coalesce(activa, true) = true`
// — o sea: único dentro de su espacio, solo entre mesas activas y no unidas. La
// comprobación de cliente vive en `src/components/espacios/nombresMesa.ts`
// (compartida con el editor de plano, NO la dupliques) y normaliza igual que el
// índice; si se cuela un duplicado por tener dos pestañas abiertas, el que avisa
// es el índice y `useActualizarMesa` traduce su 23505 a algo legible.
//
// MESAS REALES vs MESAS UNIDAS: para el aforo NO son lo mismo y la pantalla lo
// tiene que dejar claro. Las uniones (`is_merged = true`) no suman plazas,
// porque sus originales pueden seguir vivas en la tabla (el editor las borra sin
// comprobar el error del DELETE). Por eso el resumen de cada espacio dice "N
// mesas = X plazas" (reales) y, aparte, "+ M juntadas (Y plazas, no cuentan)".
// El caso extremo verificado el 2026-09-27 es la Terraza: 3 filas, las 3
// uniones, CERO mesas reales → aforo real 0, y el aviso tiene que decir qué
// hacer (volver a dar de alta las mesas), no un genérico "sin mesas".
//
// IMPORTANTE — el cuadre es información, NO un bloqueo. Un espacio descuadrado
// se puede guardar igual y se puede seguir reservando: hoy el aforo lo decide
// `capacidad_maxima` a través del trigger `trg_validar_capacidad`, que no se ha
// tocado. La regla de "que mande la suma de las mesas" está escrita y lista en
// `supabase/migrations/20260926120000_capacidad_efectiva_mesas.sql`, pero
// DORMIDA (ni aplicada ni enchufada al trigger). Lo único que SÍ bloquea aquí
// es guardar un número repetido o vacío.
//
// Las cuentas NO se hacen aquí: viven en `src/lib/reservas/aforoMesas.ts`, que
// replica exactamente el filtro de las funciones SQL de capacidad efectiva
// (espacios activos + misma marca + `coalesce(is_merged,false) = false`).
//
// SOLO CASA TOMÁS (decisión del dueño, 2026-10-01: Touza no admite reservas):
// se enseñan las salas de Casa Tomás y un único resumen de aforo; las salas de
// Touza que queden en la base de datos no salen (`salaAdmiteReservas`).
// ============================================================================

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Check,
  Circle,
  LayoutGrid,
  Loader2,
  MapPinned,
  Pencil,
  RectangleHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMesas, useActualizarMesa, type Mesa } from "@/hooks/useMesas";
import { useEspaciosReserva, type EspacioReserva } from "@/hooks/useEspaciosReserva";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  calcularCuadres,
  calcularCuadreTotal,
  textoEstadoCuadre,
  type CuadreEspacio,
  type CuadreTotal,
} from "@/lib/reservas/aforoMesas";
import {
  mensajeNombreMesaDuplicado,
  nombreMesaDuplicado,
} from "@/components/espacios/nombresMesa";
import { salaAdmiteReservas } from "@/lib/reservas/negocios";

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
  const etiqueta =
    cuadre.estado === "sin_mesas"
      ? "Sin mesas"
      : cuadre.estado === "solo_fusionadas"
        ? "Solo mesas unidas"
        : "No cuadra";
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {etiqueta}
    </Badge>
  );
}

// ── Fila de una mesa (con el número editable) ───────────────────────────────

/**
 * Por qué el editor es EN LA PROPIA FILA y no un diálogo: el dueño ya está
 * mirando la lista para cuadrar el aforo, y el número que tiene que corregir es
 * el que está leyendo. Un diálogo le haría perder de vista los demás números
 * del espacio, que es justo con lo que no puede chocar.
 */
interface FilaMesaProps {
  mesa: Mesa;
  /**
   * TODAS las filas del espacio (uniones e inactivas incluidas). Se pasan tal
   * cual a `nombreMesaDuplicado`, que ya aplica el mismo filtro que el índice
   * parcial de Postgres (ignora uniones e inactivas): no lo filtres aquí o los
   * dos criterios se irían separando.
   */
  mesasDelEspacio: Mesa[];
  /** Sin permiso (ver `GestionMesasEspacios`) el número se ve pero no sale el lápiz para cambiarlo. */
  puedeRenombrar: boolean;
}

function FilaMesa({ mesa, mesasDelEspacio, puedeRenombrar }: FilaMesaProps) {
  const actualizarMesa = useActualizarMesa();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");

  // `is_merged` es NULLABLE en la base aunque el tipo `Mesa` lo declare
  // `boolean` (hay un `as Mesa[]` en `useMesas`), así que se compara con
  // `=== true`: en runtime puede llegar `null`.
  const esUnida = mesa.is_merged === true;
  const inactiva = mesa.activa === false;
  const nombreActual = mesa.nombre ?? "";

  const recortado = valor.trim();
  const vacio = recortado.length === 0;
  const duplicado = !vacio && nombreMesaDuplicado(valor, mesasDelEspacio, mesa.id);
  // Aviso SUAVE (no bloquea): hay salas con "1A", "B2" o "Barra" y el número lo
  // decide el dueño. Pero en producción hay una mesa llamada "o" en el Comedor
  // —un tecleo suelto— y este aviso es lo que habría evitado que se guardase.
  const sinNumero = !vacio && !duplicado && !/\d/.test(recortado);
  const noValido = vacio || duplicado;
  const idAviso = `mesa-numero-aviso-${mesa.id}`;

  const aviso = vacio
    ? "El número no puede quedar vacío."
    : duplicado
      ? mensajeNombreMesaDuplicado(valor)
      : sinNumero
        ? "Ojo: este nombre no lleva ningún número. Se guardará tal cual."
        : null;

  const empezar = () => {
    setValor(nombreActual);
    setEditando(true);
  };

  const cancelar = () => {
    setEditando(false);
    setValor("");
  };

  const guardar = async () => {
    if (noValido || actualizarMesa.isPending) return;
    // Sin cambios de verdad: no se molesta a la base de datos (ni se lanza un
    // UPDATE que podría chocar contra el índice por nada).
    if (recortado === nombreActual.trim()) {
      cancelar();
      return;
    }
    try {
      await actualizarMesa.mutateAsync({ id: mesa.id, nombre: recortado });
      toast.success(`Mesa renombrada a "${recortado}"`);
      cancelar();
    } catch {
      // `useActualizarMesa` ya avisa por toast (y traduce el 23505 del índice
      // único a "ya hay una mesa con ese número"). Se deja el campo abierto con
      // lo que escribió el usuario para que pueda corregirlo sin repetirlo todo.
    }
  };

  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm",
        inactiva && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {mesa.forma === "circular" ? (
          <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <RectangleHorizontal
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}

        {editando ? (
          <div
            className="flex min-w-0 flex-wrap items-center gap-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void guardar();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelar();
              }
            }}
          >
            <Input
              /* El campo se abre por una acción explícita del usuario (pulsar
                 "Cambiar el número"), así que el foco automático no roba nada:
                 sin él habría que volver a pinchar para escribir. */
              autoFocus
              enterKeyHint="done"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              aria-label={`Número de la mesa ${nombreActual}`}
              aria-invalid={noValido || undefined}
              aria-describedby={aviso ? idAviso : undefined}
              className="h-8 w-24 tabular-nums"
              disabled={actualizarMesa.isPending}
            />
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={() => void guardar()}
              disabled={noValido || actualizarMesa.isPending}
            >
              Guardar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={cancelar}
              disabled={actualizarMesa.isPending}
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <>
            <span
              className="truncate font-medium"
              title={
                esUnida
                  ? "El número de una mesa unida lo genera el editor de plano juntando los de las mesas que la forman, así que no se cambia aquí."
                  : undefined
              }
            >
              {mesa.nombre}
            </span>
            {mesa.etiqueta && (
              <span className="truncate text-muted-foreground">· {mesa.etiqueta}</span>
            )}
            {esUnida && (
              <Badge variant="outline" className="shrink-0 text-muted-foreground">
                Unida
              </Badge>
            )}
            {inactiva && (
              <Badge variant="outline" className="shrink-0 text-muted-foreground">
                Sin usar
              </Badge>
            )}
            {!esUnida && puedeRenombrar && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={empezar}
                aria-label={`Cambiar el número de la mesa ${nombreActual}`}
                title="Cambiar el número de esta mesa"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="tabular-nums text-muted-foreground">
          {plural(Number(mesa.capacidad) || 0, "plaza", "plazas")}
        </span>
      </div>

      {editando && aviso && (
        <p
          id={idAviso}
          role="status"
          className={cn(
            "w-full text-xs",
            noValido ? "text-destructive" : "text-amber-700 dark:text-amber-300",
          )}
        >
          {aviso}
        </p>
      )}
    </li>
  );
}

// ── Bloque de un espacio ────────────────────────────────────────────────────

interface BloqueEspacioProps {
  cuadre: CuadreEspacio;
  mesas: Mesa[];
  puedeAbrirPlano: boolean;
  puedeRenombrar: boolean;
  onAbrirPlano: () => void;
}

/** Aviso del espacio: para "solo uniones" tiene que decir QUÉ HACER, no "sin mesas". */
function AvisoCuadre({ cuadre }: { cuadre: CuadreEspacio }) {
  if (!cuadre.descuadra) return null;
  const texto =
    cuadre.estado === "solo_fusionadas"
      ? `${
          cuadre.mesasFusionadas === 1
            ? "La única mesa de este espacio es una unión"
            : `Las ${cuadre.mesasFusionadas} mesas de este espacio son uniones`
        }; se perdieron las originales al fusionarlas, así que no queda ni una mesa real y su aforo real es 0. Hay que volver a darlas de alta en el editor de plano.`
      : `${textoEstadoCuadre(cuadre)}. No impide reservar: hoy el aforo lo marca la capacidad declarada.`;

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{texto}</span>
    </p>
  );
}

function BloqueEspacio({ cuadre, mesas, puedeAbrirPlano, puedeRenombrar, onAbrirPlano }: BloqueEspacioProps) {
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
          {/* Mesas REALES: son las únicas que suman aforo. */}
          <span className="text-muted-foreground">
            {plural(cuadre.mesasReales, "mesa", "mesas")} ={" "}
            <strong className="text-foreground tabular-nums">{cuadre.plazasMesas}</strong> plazas
          </span>
          {/* Y aparte las uniones, para que se entienda de un vistazo por qué el
              Salón pasó de 64 plazas a 36 el 2026-09-27. */}
          {cuadre.mesasFusionadas > 0 && (
            <span className="text-muted-foreground">
              + {plural(cuadre.mesasFusionadas, "juntada", "juntadas")} (
              <span className="tabular-nums">{cuadre.plazasFusionadas}</span> plazas, no cuentan
              para el aforo)
            </span>
          )}
          <BadgeCuadre cuadre={cuadre} />
        </div>
      </div>

      <AvisoCuadre cuadre={cuadre} />

      {mesas.length > 0 ? (
        <>
          <ul className="divide-y rounded-md border">
            {mesas.map((mesa) => (
              <FilaMesa key={mesa.id} mesa={mesa} mesasDelEspacio={mesas} puedeRenombrar={puedeRenombrar} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Puedes corregir el número de una mesa para que sea el mismo que en la sala. Las
            mesas se dan de alta y se borran en el plano; el número de una mesa unida lo genera
            el plano y no se edita.
          </p>
        </>
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
          Las mesas se dan de alta y se borran en el plano (Super Admin → Espacios).
        </p>
      )}
    </div>
  );
}

// ── Resumen del aforo (salas activas de Casa Tomás) ─────────────────────────

function ResumenAforo({ resumen }: { resumen: CuadreTotal }) {
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
      {resumen.plazasFusionadas > 0 && (
        <span>
          (sin contar{" "}
          <span className="tabular-nums">{resumen.plazasFusionadas}</span> plazas de mesas
          juntadas)
        </span>
      )}
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
  // botón que lleva allí. El resto ve una nota indicando dónde se dan de alta
  // las mesas, en vez de un botón que le llevaría a un login.
  //
  // OJO: corregir el NÚMERO de una mesa no está detrás de este permiso, a
  // propósito. Quien ve esta pestaña de Configuración es quien cuadra el aforo,
  // y el encargo del dueño es justo que pueda arreglar el número desde aquí sin
  // pasar por Super Admin. Crear y borrar mesas sí sigue siendo solo del plano.
  const { isSuperAdmin, loading: cargandoPermiso } = useSuperAdmin();
  // Cambiar el número de una mesa (04/11/2026): «Puede editar» en «Reservas · Configuración» (la pestaña)
  // y también en «Reservas», porque `mesas` la comparten las vistas del servicio (unir mesas, plano) y su
  // RLS sigue siendo la de la sección «reservas». Sin los dos, el número se ve pero no se toca.
  const { canAccess: editaConfiguracion } = useCanAccessSection("reservas_configuracion", "edit");
  const { canAccess: editaReservas } = useCanAccessSection("reservas", "edit");
  const puedeRenombrar = editaConfiguracion && editaReservas;

  // Solo las salas de Casa Tomás (activas o no): las de Touza no se enseñan.
  const espacios = useMemo(
    () => ((espaciosData ?? []) as EspacioReserva[]).filter((e) => !!e && salaAdmiteReservas(e)),
    [espaciosData],
  );

  const cuadres = useMemo(() => calcularCuadres(espacios, mesas), [espacios, mesas]);
  const resumen = useMemo(() => calcularCuadreTotal(cuadres), [cuadres]);

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
    <Card className="reservas-legible">
      <CardHeader>
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle className="text-lg">Mesas y aforo por espacio</CardTitle>
        </div>
        <CardDescription>
          Comprueba si la capacidad declarada de cada sala cuadra con las plazas que
          suman sus mesas y corrige aquí el número de cualquier mesa para que sea el
          mismo que en la sala. Las mesas se dan de alta y se borran en el plano
          (Super Admin → Espacios → "Configurar Plano y Mesas").
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {espacios.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay espacios de reserva dados de alta.
          </p>
        ) : (
          <section className="space-y-3">
            {resumen && (
              <div className="flex flex-wrap items-center gap-2">
                <ResumenAforo resumen={resumen} />
              </div>
            )}
            <div className="space-y-3">
              {cuadres.map((cuadre) => (
                <BloqueEspacio
                  key={cuadre.espacioId}
                  cuadre={cuadre}
                  mesas={mesasDeEspacio(cuadre.espacioId)}
                  puedeAbrirPlano={!cargandoPermiso && isSuperAdmin}
                  puedeRenombrar={puedeRenombrar}
                  onAbrirPlano={() => abrirPlano(cuadre.espacioId)}
                />
              ))}
            </div>
          </section>
        )}

        <Separator />

        <p className="text-sm text-muted-foreground">
          Hoy el aforo lo decide la <strong className="text-foreground">capacidad declarada</strong>{" "}
          de cada espacio; la suma de las mesas es solo informativa. Las mesas juntadas no
          suman plazas: sus plazas ya las aportan las mesas que las forman. Los avisos de
          arriba no impiden guardar ni reservar.
        </p>
      </CardContent>
    </Card>
  );
}
