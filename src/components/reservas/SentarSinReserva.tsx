// ============================================================================
// «SIN RESERVA» — sentar a quien entra sin reservar, en 2-3 toques
// ----------------------------------------------------------------------------
// Abrir → tocar cuántos son (la mejor mesa libre AHORA ya queda marcada) →
// «Sentar». El nombre es opcional («Sin reserva 21:05»). Si no cabe en ninguna
// mesa libre, se ofrece la propuesta de piezas; y si ni así, sentar sin mesa.
// Lógica: `src/lib/reservas/sentarAhora.ts`; escritura: `useSentarSinReserva`.
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
import { deshacerSinReserva, useSentarSinReserva } from "@/hooks/useSentarSinReserva";
import { configAsignacionDesde } from "@/lib/reservas/ventanaAsignacion";
import { configServicioSalaDesde } from "@/lib/reservas/servicioSala";
import { horaActual, nombreSinReserva, opcionesParaSentar, ordenarParaSinReserva } from "@/lib/reservas/sentarAhora";
import type { MesaOpcion } from "@/lib/reservas/hoyMovil";
import { cn } from "@/lib/utils";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

export function BotonSentarSinReserva({
  salaPreferida = null,
  className,
}: {
  /** Desde el plano de una sala: sus mesas primero. */
  salaPreferida?: string | null;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className={cn("h-11 touch-manipulation gap-1.5 whitespace-nowrap", className)}
        onClick={() => setAbierto(true)}
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        Sin reserva
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
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

  const { data: espacios } = useEspaciosReserva();
  const { data: mesas } = useMesas();
  const { data: asignaciones } = useAsignacionesMesa(hoy);
  const { data: ajustesDia } = useAjustesMesaDia(hoy);
  const { data: config } = useConfiguracionReservas();
  const sentar = useSentarSinReserva();

  const salas = useMemo(
    () => ((espacios ?? []) as Array<{ id: string; nombre: string }>).map((e) => ({ id: e.id, nombre: e.nombre })),
    [espacios],
  );
  const cargando = !espacios || !mesas || !asignaciones;

  const { lista, propuesta } = useMemo(() => {
    if (!personas || cargando) return { lista: [] as MesaOpcion[], propuesta: null };
    const r = opcionesParaSentar({
      salas,
      mesas: mesas ?? [],
      ajustesDia: ajustesDia ?? [],
      asignaciones: asignaciones ?? [],
      excluidas: new Set(configAsignacionDesde(config).mesasExcluidas),
      configOcupacion: configServicioSalaDesde(config),
      reserva: { id: "", hora, comensales: personas, espacioId: null },
    });
    const ordenadas = ordenarParaSinReserva(r.caben);
    const lista = salaPreferida
      ? [...ordenadas.filter((m) => m.espacioId === salaPreferida), ...ordenadas.filter((m) => m.espacioId !== salaPreferida)]
      : ordenadas;
    return { lista, propuesta: r.propuesta };
  }, [personas, cargando, salas, mesas, ajustesDia, asignaciones, config, hora, salaPreferida]);

  const elegida = lista.find((m) => m.id === elegidaId) ?? lista[0] ?? null;

  const confirmar = async () => {
    if (!personas) return;
    const mesa = elegida ?? propuesta?.mesa ?? null;
    const cambios = !elegida && propuesta ? propuesta.propuesta.cambios : undefined;
    try {
      const r = await sentar.mutateAsync({ fecha: hoy, hora, personas, nombre, mesa, cambios });
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
    }
  };

  const textoBoton = !personas
    ? "Elige cuántos son"
    : elegida
      ? `Sentar en mesa ${elegida.nombre}`
      : propuesta
        ? `Hacer y sentar en la ${propuesta.mesa.nombre}`
        : "Sentar sin mesa";

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
            onClick={() => {
              setPersonas(n);
              setOtras("");
              setElegidaId(null);
            }}
          >
            {n}
          </Button>
        ))}
      </div>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        placeholder="Más de 8…"
        value={otras}
        className="h-11 text-base"
        aria-label="Número de personas"
        onChange={(e) => {
          setOtras(e.target.value);
          const n = parseInt(e.target.value, 10);
          setPersonas(Number.isFinite(n) && n > 0 ? n : null);
          setElegidaId(null);
        }}
      />

      {personas && (
        <div className="space-y-2">
          {cargando ? (
            <p className="text-sm text-muted-foreground">Buscando mesa…</p>
          ) : lista.length > 0 ? (
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {lista.map((m) => (
                <Button
                  key={m.id}
                  variant={elegida?.id === m.id ? "default" : "outline"}
                  className="h-12 flex-col gap-0 px-3"
                  onClick={() => setElegidaId(m.id)}
                >
                  <span className="font-semibold">Mesa {m.nombre}</span>
                  <span className="text-xs opacity-80">
                    {m.salaNombre} · {m.plazas}
                  </span>
                </Button>
              ))}
            </div>
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

      <Button className="h-14 w-full text-base" disabled={!personas || cargando || sentar.isPending} onClick={confirmar}>
        {textoBoton}
      </Button>
    </div>
  );
}
