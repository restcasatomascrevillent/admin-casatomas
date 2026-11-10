// ============================================================================
// «SIN RESERVA» — sentar a quien entra sin reservar, en 2-3 toques
// ----------------------------------------------------------------------------
// Abrir → tocar cuántos son (la mejor mesa libre AHORA ya queda marcada) →
// «Sentar». El nombre es opcional («Sin reserva 21:05»).
// 10/11/2026 (petición del dueño): las mesas salen como al sentar una reserva
// sin mesa: TODAS las de todas las salas donde caben, con su estado (libre,
// prevista para otra reserva, ocupada/fijada), con el mismo selector
// (`SelectorMesaMovil`). Coger una prevista avisa y se la quita a esa reserva
// (recolocándola si hay sitio), igual que en la hoja de la mesa.
// Si no cabe en ninguna mesa, se ofrece la propuesta de piezas; y si ni así,
// sentar sin mesa.
// Lógica: `src/lib/reservas/sentarAhora.ts` y `confirmarMesa.ts`; escritura:
// `useSentarSinReserva` y `useDesplazarReservas`.
// Nada bloquea: si algo falla, un aviso y el panel sigue a mano.
// ============================================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useMesas } from "@/hooks/useMesas";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { useAjustesMesaDia } from "@/hooks/useAjustesMesaServicio";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useHoyLocal } from "@/hooks/useHoyLocal";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { deshacerSinReserva, useSentarSinReserva, type EntradaSinReserva } from "@/hooks/useSentarSinReserva";
import { configAsignacionDesde } from "@/lib/reservas/ventanaAsignacion";
import { configServicioSalaDesde } from "@/lib/reservas/servicioSala";
import {
  horaActual,
  nombreSinReserva,
  opcionesMesasServicio,
  opcionesParaSentar,
  ordenarParaSinReserva,
} from "@/lib/reservas/sentarAhora";
import { clasificarMesasParaSentar, textoDesplazamiento, type Desplazamiento } from "@/lib/reservas/confirmarMesa";
import { recolocarDesplazadas } from "@/lib/reservas/recalcularMesas";
import { turnoDeHora } from "@/lib/reservas/asignacionMesas";
import type { MesaOpcion } from "@/lib/reservas/hoyMovil";
import { useAsignarConCambioLocal, useDesplazar } from "@/hooks/useDesplazarReservas";
import { ConfirmarDesplazamiento, SelectorMesaMovil, type Pendiente } from "@/components/reservas/SelectorMesa";
import { cn } from "@/lib/utils";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

export function BotonSentarSinReserva({
  salaPreferida = null,
  soloIcono = false,
  className,
}: {
  /** Desde el plano de una sala: sus mesas primero. */
  salaPreferida?: string | null;
  /** Solo el icono (Hoy en móvil, 07/11/2026: una sola fila de controles). El texto queda como nombre accesible. */
  soloIcono?: boolean;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  // Sentar sin reserva CREA una reserva: exige «Editar» en Reservas. Con solo «Ver» el botón no
  // existe (06/11/2026, decisión del dueño: se oculta, no se desactiva), esté donde esté.
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  if (!puedeEditar) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className={cn("h-11 touch-manipulation gap-1.5 whitespace-nowrap", soloIcono && "w-11 px-0 pointer-coarse:px-0", className)}
        onClick={() => setAbierto(true)}
        aria-label={soloIcono ? "Sin reserva" : undefined}
        title={soloIcono ? "Sentar sin reserva" : undefined}
      >
        <UserPlus className={soloIcono ? "h-5 w-5" : "h-4 w-4"} aria-hidden />
        {!soloIcono && "Sin reserva"}
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          {abierto && <ContenidoSinReserva salaPreferida={salaPreferida} onCerrar={() => setAbierto(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

const PERSONAS = [1, 2, 3, 4, 5, 6, 7, 8];

function ContenidoSinReserva({ salaPreferida, onCerrar }: { salaPreferida: string | null; onCerrar: () => void }) {
  const hoy = useHoyLocal();
  // La hora se fija al abrir: es la de la reserva que se crea.
  const [hora] = useState(() => horaActual());
  const [personas, setPersonas] = useState<number | null>(null);
  const [otras, setOtras] = useState("");
  const [nombre, setNombre] = useState("");
  const [elegidaId, setElegidaId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);

  const { data: espacios } = useEspaciosReserva();
  const { data: mesas } = useMesas();
  const { data: asignaciones } = useAsignacionesMesa(hoy);
  const { data: ajustesDia } = useAjustesMesaDia(hoy);
  const { data: config } = useConfiguracionReservas();
  const sentar = useSentarSinReserva();
  const desplazar = useDesplazar(useAsignarConCambioLocal(hoy, mesas ?? []));

  const salas = useMemo(
    () => ((espacios ?? []) as Array<{ id: string; nombre: string }>).map((e) => ({ id: e.id, nombre: e.nombre })),
    [espacios],
  );
  const cargando = !espacios || !mesas || !asignaciones;
  const reparto = useMemo(() => configAsignacionDesde(config), [config]);
  const excluidas = useMemo(() => new Set(reparto.mesasExcluidas), [reparto]);
  const alFinal = useMemo(() => new Set(reparto.mesasAlFinal), [reparto]);
  const configOcupacion = useMemo(() => configServicioSalaDesde(config), [config]);
  // Todas las mesas del servicio de ahora (con las piezas del día), como en la ficha de una reserva.
  const opciones = useMemo(
    () => opcionesMesasServicio({ salas, mesas: mesas ?? [], ajustesDia: ajustesDia ?? [], turno: turnoDeHora(hora) }),
    [salas, mesas, ajustesDia, hora],
  );

  const { lista, propuesta } = useMemo(() => {
    if (!personas || cargando) return { lista: [] as MesaOpcion[], propuesta: null };
    const r = opcionesParaSentar({
      salas,
      mesas: mesas ?? [],
      ajustesDia: ajustesDia ?? [],
      asignaciones: asignaciones ?? [],
      excluidas,
      alFinal,
      configOcupacion,
      reserva: { id: "", hora, comensales: personas, espacioId: null },
    });
    const ordenadas = ordenarParaSinReserva(r.caben, alFinal);
    const lista = salaPreferida
      ? [...ordenadas.filter((m) => m.espacioId === salaPreferida), ...ordenadas.filter((m) => m.espacioId !== salaPreferida)]
      : ordenadas;
    return { lista, propuesta: r.propuesta };
  }, [personas, cargando, salas, mesas, ajustesDia, asignaciones, excluidas, alFinal, configOcupacion, hora, salaPreferida]);

  // El selector: todas las mesas donde caben, de todas las salas (la del plano primero), con su estado ahora.
  const selector = useMemo(
    () =>
      clasificarMesasParaSentar({
        opciones,
        asignaciones: asignaciones ?? [],
        reserva: { id: "", hora, comensales: personas ?? 1, espacioId: salaPreferida },
        propias: [],
        excluidas,
        alFinal,
        config: configOcupacion,
      }),
    [opciones, asignaciones, hora, personas, salaPreferida, excluidas, alFinal, configOcupacion],
  );
  const elegibles = useMemo(
    () => selector.salas.flatMap((s) => s.mesas).filter((m) => m.estado.tipo === "libre" || m.estado.tipo === "prevista"),
    [selector],
  );
  // Marcada: la que se toque; si no, la mejor libre ahora (como antes).
  const elegida = elegibles.find((m) => m.id === elegidaId) ?? elegibles.find((m) => m.id === lista[0]?.id) ?? null;
  const nombreMesa = (id: string) => (mesas ?? []).find((m) => m.id === id)?.nombre ?? "?";

  const sentarYa = async (mesa: MesaOpcion | null, desplazadas: readonly Desplazamiento[], cambios?: EntradaSinReserva["cambios"]) => {
    if (!personas) return;
    setOcupado(true);
    try {
      const deshacerDesplazar = await desplazar(desplazadas);
      const r = await sentar.mutateAsync({ fecha: hoy, hora, personas, nombre, mesa, cambios });
      if (r.errorMesa) await deshacerDesplazar();
      onCerrar();
      const donde = mesa ? `mesa ${mesa.nombre} (${mesa.salaNombre})` : "sin mesa";
      const deshacer = {
        label: "Deshacer",
        onClick: async () => {
          if (await deshacerSinReserva(r.id)) toast.success("Deshecho");
          else toast.error("No se ha podido deshacer");
        },
      };
      if (r.errorMesa) toast.warning(`${r.nombre} sentado sin mesa: ${r.errorMesa}`, { action: deshacer });
      else toast.success(`${r.nombre} → ${donde}`, { action: deshacer });
    } catch (e) {
      toast.error(`No se ha podido sentar: ${mensajeUsuario(e, "error")}`);
    } finally {
      setOcupado(false);
      setPendiente(null);
    }
  };

  const confirmar = () => {
    if (!personas) return;
    if (!elegida) {
      void sentarYa(propuesta?.mesa ?? null, [], propuesta ? propuesta.propuesta.cambios : undefined);
      return;
    }
    // Prevista para otra reserva: se le quita (y se le busca otra libre de su sala), avisando antes.
    const desplazadas =
      elegida.estado.tipo === "prevista"
        ? recolocarDesplazadas({
            desplazadas: elegida.estado.desplazadas,
            opciones,
            asignaciones: asignaciones ?? [],
            mesasElegidas: [elegida.id],
            excluidas,
            alFinal,
            config: configOcupacion,
          })
        : [];
    const textos = [
      personas > elegida.plazas ? `Son ${personas} y la mesa ${elegida.nombre} es de ${elegida.plazas}.` : "",
      desplazadas.length > 0 ? textoDesplazamiento(elegida.nombre, desplazadas, nombreMesa) : "",
    ].filter(Boolean);
    if (textos.length > 0) setPendiente({ texto: textos.join(" "), ejecutar: () => sentarYa(elegida, desplazadas) });
    else void sentarYa(elegida, []);
  };

  const textoBoton = !personas
    ? "Elige cuántos son"
    : elegida
      ? `Sentar en mesa ${elegida.nombre}`
      : propuesta
        ? `Hacer y sentar en la ${propuesta.mesa.nombre}`
        : "Sentar sin mesa";

  const hayMesas = selector.salas.length > 0;

  return (
    <div className="space-y-4">
      <DialogHeader className="text-left">
        <DialogTitle>Sin reserva</DialogTitle>
        <DialogDescription>¿Cuántos son? Se sientan ahora ({hora.slice(0, 5)}).</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-4 gap-2">
        {PERSONAS.map((n) => (
          <Button
            key={n}
            variant={personas === n ? "default" : "outline"}
            className="h-14 text-lg font-semibold"
            disabled={ocupado}
            onClick={() => {
              setPersonas(n);
              setOtras("");
              setElegidaId(null);
              setPendiente(null);
            }}
          >
            {n}
          </Button>
        ))}
      </div>
      {/* Cualquier número escrito a mano (10/11/2026, petición del dueño). */}
      <label className="block text-sm text-muted-foreground" htmlFor="sentar-otras-personas">
        O escribe el número de personas
      </label>
      <Input
        id="sentar-otras-personas"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={otras}
        className="h-11 text-base"
        aria-label="Número de personas"
        disabled={ocupado}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, "").slice(0, 3);
          setOtras(d);
          const n = parseInt(d, 10);
          setPersonas(Number.isFinite(n) && n > 0 ? n : null);
          setElegidaId(null);
          setPendiente(null);
        }}
      />

      {personas && (
        <div className="space-y-2">
          {cargando ? (
            <p className="text-sm text-muted-foreground">Buscando mesa…</p>
          ) : hayMesas ? (
            <>
              <p className="text-sm font-semibold">¿Dónde se sientan?</p>
              <SelectorMesaMovil
                selector={selector}
                sentada={false}
                ocupado={ocupado}
                elegidaId={elegida?.id ?? null}
                onElegir={(m) => {
                  setElegidaId(m.id);
                  setPendiente(null);
                }}
              />
              {!elegida && propuesta && (
                <p className="rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950/40">{propuesta.propuesta.texto}</p>
              )}
            </>
          ) : propuesta ? (
            <p className="rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950/40">{propuesta.propuesta.texto}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No hay mesa libre para {personas}. Se sientan sin mesa y se la das luego.</p>
          )}
        </div>
      )}

      <Input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder={nombreSinReserva("", hora)}
        className="h-11 text-base"
        aria-label="Nombre (opcional)"
      />

      {pendiente ? (
        <ConfirmarDesplazamiento
          pendiente={pendiente}
          ocupado={ocupado}
          onCancelar={() => setPendiente(null)}
          onConfirmar={() => void pendiente.ejecutar()}
        />
      ) : (
        <Button className="h-14 w-full text-base" disabled={!personas || cargando || ocupado || sentar.isPending} onClick={confirmar}>
          {textoBoton}
        </Button>
      )}
    </div>
  );
}
