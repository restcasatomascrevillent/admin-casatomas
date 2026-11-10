// ============================================================================
// «ORGANIZAR» — propuesta de sala y mesa para TODO un servicio
// ----------------------------------------------------------------------------
// Botón en el plano (fecha + comida/cena). Calcula con
// `src/lib/reservas/organizarServicio.ts` y enseña, de un vistazo, cuántos
// cambios propone y una frase por cambio. Nunca aplica nada sin «Aplicar».
// Se lee rápido: el número grande arriba, frases cortas, botones grandes.
// Si algo falla al aplicar, un aviso y el panel sigue usable.
// ============================================================================

import { servicioComidaDeReserva } from "@/lib/reservas/menuDelDia";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useMesas } from "@/hooks/useMesas";
import { useAsignacionesMesa } from "@/hooks/useAsignacionesMesa";
import { CLAVE_AJUSTES_MESA, guardarAjustesServicio, useAjustesMesaDia, type TurnoServicio } from "@/hooks/useAjustesMesaServicio";
import { useConfiguracionReservas } from "@/hooks/useConfiguracionReservas";
import { useSalaCerradaServicio } from "@/hooks/useSalaCerradaServicio";
import { eventosDelTurno, useSalasEvento } from "@/hooks/useSalaEvento";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { configAsignacionDesde } from "@/lib/reservas/ventanaAsignacion";
import { CLAVES_POR_CAMBIO } from "@/lib/reservas/clavesCache";
import { admiteReservas } from "@/lib/reservas/negocios";
import { esSalaPrivada } from "@/lib/reservas/salaPrivada";
import { mensajeErrorAsignacion, turnoDeHora } from "@/lib/reservas/asignacionMesas";
import { hoyLocal } from "@/components/reservas/asignacionPlano";
import { minutosDeHora } from "@/lib/reservas/ocupacionMesa";
import { organizarServicio, type MovimientoOrg, type ReservaOrg, type ResultadoOrg } from "@/lib/reservas/organizarServicio";
import { esSalaMesaLarga, esGrupoGrande, sugerenciaGrupoGrande, type SugerenciaGrupo } from "@/lib/reservas/grupoGrande";
import { ocupaEspacio } from "@/lib/reservas/estadosReserva";
import { usePlanoEspacio } from "@/hooks/usePlanosEspacio";
import type { AjusteMesa } from "@/lib/reservas/piezasMesa";

export function BotonOrganizarServicio({ fecha, turno }: { fecha: string; turno: TurnoServicio }) {
  const [abierto, setAbierto] = useState(false);
  // Organizar mueve reservas y da mesas: exige «Editar» en Reservas. Con solo «Ver» el botón no
  // existe (06/11/2026, decisión del dueño: se oculta, no se desactiva).
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  if (!puedeEditar) return null;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-11 touch-manipulation"
        onClick={() => setAbierto(true)}
        title="Propone la mejor sala y mesa para todas las reservas de este servicio"
      >
        <Wand2 className="mr-2 h-4 w-4" />
        Organizar
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col">
          {abierto && <ContenidoOrganizar fecha={fecha} turno={turno} onCerrar={() => setAbierto(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface FilaReserva {
  id: string;
  nombre: string | null;
  hora: string;
  numero_comensales: number;
  estado: string;
  importante?: boolean | null;
  espacio_id: string | null;
  marca?: string | null;
  salida_at?: string | null;
  mesa_fijada?: boolean | null;
}

/**
 * Todo lo de «Organizar» menos la pantalla: datos, cálculo (`organizarServicio`), «Terraza cerrada» y
 * aplicar. Lo usan el diálogo de la lista y la vista previa en los planos de Hoy (`VistaPlanoHoy`).
 */
export function usePropuestaOrganizar(fecha: string, turno: TurnoServicio, activo = true) {
  const qc = useQueryClient();
  const { data: espacios } = useEspaciosReserva();
  const { data: mesas } = useMesas();
  const { data: asignaciones } = useAsignacionesMesa(fecha);
  const { data: ajustesDia } = useAjustesMesaDia(fecha);
  const { data: config } = useConfiguracionReservas();
  const { data: reservas } = useQuery({
    enabled: activo,
    queryKey: ["reservas-servicio-dia", fecha, "organizar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reservas" as never)
        .select("*")
        .eq("fecha", fecha)
        .neq("estado", "cancelada");
      if (error) throw error;
      return ((data ?? []) as unknown as FilaReserva[]).filter((r) => admiteReservas(r.marca));
    },
  });
  const [aplicando, setAplicando] = useState(false);

  const salas = useMemo(
    () =>
      ((espacios ?? []) as Array<{ id: string; nombre: string; activa?: boolean | null; caracteristicas?: unknown }>)
        .filter((e) => e.activa !== false && !esSalaPrivada(e))
        .map((e) => ({ id: e.id, nombre: e.nombre, terraza: /terraza/i.test(e.nombre) })),
    [espacios],
  );
  const terraza = salas.find((s) => s.terraza) ?? null;
  const cierre = useSalaCerradaServicio(terraza?.id ?? null, fecha, turno);
  // «Evento: sala entera» (20261119100000): esas salas no entran en Organizar. Ni
  // se coloca a nadie en ellas ni se toca el evento (sus reservas quedan fuera).
  const { data: eventosDia } = useSalasEvento(activo ? fecha : null);
  const salasEvento = useMemo(() => eventosDelTurno(eventosDia, fecha, turno), [eventosDia, fecha, turno]);

  // Grupos de 8 o más (no se asignan solos): el Reservado y el Salón para la sugerencia.
  const reservado = useMemo(
    () =>
      ((espacios ?? []) as Array<{ id: string; nombre: string; capacidad_maxima?: number | null; activa?: boolean | null; caracteristicas?: unknown }>)
        .find((e) => e.activa !== false && esSalaPrivada(e)) ?? null,
    [espacios],
  );
  const salon = salas.find((s) => esSalaMesaLarga(s.nombre)) ?? null;
  const { data: planoSalon } = usePlanoEspacio(activo ? salon?.id : undefined);

  const cargando = !espacios || !mesas || !asignaciones || !reservas;

  /** Mesas de cada reserva en este turno (lo que hay ahora). */
  const mesasDe = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const a of asignaciones ?? []) {
      if (turnoDeHora(a.reservas?.hora ?? "") !== turno) continue;
      mapa.set(a.reserva_id, [...(mapa.get(a.reserva_id) ?? []), a.mesa_id]);
    }
    return mapa;
  }, [asignaciones, turno]);

  /** Sugerencia (Reservado / mesa larga en el Salón) de cada grupo grande del turno. */
  const sugerencias = useMemo(() => {
    const mapa = new Map<string, SugerenciaGrupo>();
    if (cargando || !activo) return mapa;
    const delTurno = (reservas ?? []).filter((r) => turnoDeHora(r.hora) === turno);
    const ocupadoPor = (id: string) => {
      const otra = reservado
        ? delTurno.find((x) => x.id !== id && x.espacio_id === reservado.id && ocupaEspacio(x.estado))
        : undefined;
      return otra ? otra.nombre?.trim() || "otra reserva" : null;
    };
    const ocupadas = new Set<string>();
    for (const ids of mesasDe.values()) for (const id of ids) ocupadas.add(id);
    for (const r of delTurno) {
      if (!esGrupoGrande(r.numero_comensales) || (mesasDe.get(r.id)?.length ?? 0) > 0) continue;
      const s = sugerenciaGrupoGrande({
        comensales: r.numero_comensales,
        reservado: reservado
          ? { id: reservado.id, nombre: reservado.nombre, capacidad: reservado.capacidad_maxima, ocupadoPor: ocupadoPor(r.id) }
          : null,
        salon: salon
          ? { id: salon.id, nombre: salon.nombre, mesas: (mesas ?? []).filter((m) => m.espacio_id === salon.id), plano: planoSalon, ocupadas }
          : null,
      });
      if (s) mapa.set(r.id, s);
    }
    return mapa;
  }, [cargando, activo, reservas, turno, reservado, salon, mesas, planoSalon, mesasDe]);

  const resultado = useMemo(() => {
    if (cargando || !activo) return null;
    const salasOrg = salas.filter((s) => !salasEvento.has(s.id));
    const salaIds = new Set(salasOrg.map((s) => s.id));
    const lista: ReservaOrg[] = (reservas ?? [])
      .filter((r) => turnoDeHora(r.hora) === turno && (!r.espacio_id || salaIds.has(r.espacio_id)))
      .map((r) => ({
        id: r.id,
        nombre: r.nombre ?? "",
        hora: r.hora,
        comensales: r.numero_comensales,
        estado: r.estado,
        importante: !!r.importante,
        espacioId: r.espacio_id,
        mesaIds: mesasDe.get(r.id) ?? [],
        salidaAt: r.salida_at ?? null,
        fijada: !!r.mesa_fijada,
        // Martes a jueves comida: menú del día → Comedor/Terraza; carta → Salón, Comedor o Terraza.
        servicioComida: servicioComidaDeReserva({ fecha, hora: r.hora, menu_del_dia: (r as { menu_del_dia?: boolean | null }).menu_del_dia }),
      }));
    const ahora = new Date();
    const empezado = fecha === hoyLocal() && turnoDeHora(ahora.toTimeString().slice(0, 8)) === turno;
    return organizarServicio({
      salas: salasOrg,
      mesas: (mesas ?? []).filter((m) => salaIds.has(m.espacio_id)),
      ajustes: (ajustesDia ?? []).filter((a) => a.turno === turno),
      reservas: lista,
      terrazaCerrada: cierre.cerrada,
      minutoAhora: empezado ? minutosDeHora(ahora.toTimeString().slice(0, 5)) : null,
      excluidas: new Set(configAsignacionDesde(config).mesasExcluidas),
      alFinal: new Set(configAsignacionDesde(config).mesasAlFinal),
      sugerirGrupo: (r) => sugerencias.get(r.id)?.texto ?? null,
    });
  }, [cargando, activo, salas, salasEvento, mesasDe, reservas, mesas, ajustesDia, turno, fecha, cierre.cerrada, config, sugerencias]);

  const refrescar = () => {
    for (const clave of CLAVES_POR_CAMBIO.ocupacion) void qc.invalidateQueries({ queryKey: [clave] });
    void qc.invalidateQueries({ queryKey: [CLAVE_AJUSTES_MESA] });
  };

  /** Aplica una lista de cambios: primero suelta mesas, luego ajustes, luego asigna. */
  const aplicar = async (movs: MovimientoOrg[]) => {
    if (movs.length === 0) return;
    setAplicando(true);
    let fallos = 0;
    try {
      const porId = new Map((reservas ?? []).map((r) => [r.id, r]));
      // 1. Soltar: cambiar de sala (el trigger quita las mesas) o quitar las mesas de ahora.
      for (const m of movs) {
        const r = porId.get(m.reservaId);
        if (!r) continue;
        if (r.espacio_id !== m.hacia.salaId) {
          const { data, error } = await supabase
            .from("reservas" as never)
            .update({ espacio_id: m.hacia.salaId } as never)
            .eq("id", m.reservaId)
            .select("id");
          if (error || !(data as unknown[] | null)?.length) {
            fallos++;
            toast.error(`${m.nombre}: no se ha podido cambiar de sala`);
          }
        } else if (m.desde) {
          await supabase.rpc("asignar_mesas_reserva", { p_reserva_id: m.reservaId, p_mesa_ids: [] });
        }
      }
      // 2. Ajustes de piezas, picos, plazas y uniones (por sala; el último manda).
      const porSala = new Map<string, Map<string, AjusteMesa>>();
      for (const m of movs) {
        for (const a of m.ajustes) {
          const mapa = porSala.get(a.salaId) ?? new Map<string, AjusteMesa>();
          for (const c of a.cambios) mapa.set(c.mesaId, c);
          porSala.set(a.salaId, mapa);
        }
      }
      for (const [salaId, mapa] of porSala) {
        try {
          await guardarAjustesServicio(salaId, fecha, turno, [...mapa.values()]);
        } catch {
          fallos++;
          toast.error("No se han podido guardar los cambios de piezas");
        }
      }
      // 3. Asignar.
      for (const m of movs) {
        const { error } = await supabase.rpc("asignar_mesas_reserva", {
          p_reserva_id: m.reservaId,
          p_mesa_ids: m.hacia.mesaIds,
        });
        if (error) {
          fallos++;
          toast.error(`${m.nombre}: ${mensajeErrorAsignacion(error)}`);
        }
      }
      if (fallos === 0) toast.success(movs.length === 1 ? "Hecho" : `${movs.length} cambios aplicados`);
    } finally {
      refrescar();
      setAplicando(false);
    }
  };

  return { resultado, aplicar, aplicando, terraza, cierre, cargando, mesasDe, reservas, ajustesDia, salas, sugerencias, salasEvento };
}

function ContenidoOrganizar({ fecha, turno, onCerrar }: { fecha: string; turno: TurnoServicio; onCerrar: () => void }) {
  const { resultado, aplicar, aplicando, terraza, cierre } = usePropuestaOrganizar(fecha, turno);
  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="text-2xl">
          {!resultado ? "Calculando…" : resultado.resumen}
        </DialogTitle>
        <DialogDescription>
          {turno === "comida" ? "Comida" : "Cena"} del {fecha.split("-").reverse().join("/")}. Nada se mueve hasta que pulses «Aplicar».
        </DialogDescription>
      </DialogHeader>

      {terraza && (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <Label htmlFor="terraza-cerrada" className="text-sm">
            {terraza.nombre} cerrada en este servicio
            {cierre.local && <span className="block text-xs text-muted-foreground">Se guarda solo en este dispositivo (falta una migración).</span>}
          </Label>
          <Switch id="terraza-cerrada" checked={cierre.cerrada} onCheckedChange={(v) => void cierre.cambiar(v)} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {resultado && <ListaPropuesta resultado={resultado} aplicando={aplicando} onAplicar={(m) => void aplicar([m])} />}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" className="h-12" onClick={onCerrar}>
          {resultado?.yaOrganizado ? "Cerrar" : "Descartar"}
        </Button>
        <Button
          className="h-12"
          disabled={!resultado || resultado.movimientos.length === 0 || aplicando}
          onClick={() => void aplicar(resultado?.movimientos ?? [])}
        >
          {aplicando ? "Aplicando…" : "Aplicar todo"}
        </Button>
      </div>
    </>
  );
}

/** Las frases de la propuesta (cada una con «Aplicar») y las que no caben. */
export function ListaPropuesta({
  resultado,
  aplicando,
  onAplicar,
}: {
  resultado: ResultadoOrg;
  aplicando: boolean;
  onAplicar: (m: MovimientoOrg) => void;
}) {
  return (
    <div className="space-y-2">
      {resultado.movimientos.map((m) => (
        <div key={m.reservaId} className="flex items-center gap-2 rounded-md border p-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{m.importante ? "★ " : ""}{m.texto}</p>
            {m.detalle && m.desde && <p className="text-xs text-muted-foreground">{m.detalle}</p>}
          </div>
          <Button variant="outline" className="h-11 shrink-0" disabled={aplicando} onClick={() => onAplicar(m)}>
            Aplicar
          </Button>
        </div>
      ))}
      {resultado.revisarAMano.length > 0 && (
        <div className="rounded-md border border-sky-300 bg-sky-50 p-2 text-sm dark:border-sky-800 dark:bg-sky-950/40" data-testid="revisar-a-mano">
          <p className="font-medium">Grupos de 8 o más: asígnalos a mano ({resultado.revisarAMano.length})</p>
          <ul className="mt-1 space-y-1">
            {resultado.revisarAMano.map((g) => (
              <li key={g.reservaId}>
                <span className="font-medium">{g.nombre || "Sin nombre"}</span> ({g.comensales} p., {g.hora.slice(0, 5)}): {g.sugerencia}
              </li>
            ))}
          </ul>
        </div>
      )}
      {resultado.sinSitio.length > 0 && (
        <div className="rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950/40">
          <p className="font-medium">Sin sitio ({resultado.sinSitio.length})</p>
          <ul className="mt-1 space-y-0.5">
            {resultado.sinSitio.map((s) => (
              <li key={s.reservaId}>
                {s.nombre} ({s.comensales} p., {s.hora.slice(0, 5)}): {s.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
