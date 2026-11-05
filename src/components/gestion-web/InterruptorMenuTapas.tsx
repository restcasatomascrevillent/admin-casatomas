import { useEffect, useId, useState } from "react";
import { CalendarClock, ChevronDown, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useConfiguracionWeb, type BotonMenuTapas } from "@/hooks/useConfiguracionWeb";
import {
  DIAS_SEMANA,
  HORARIO_POR_DEFECTO,
  errorHorario,
  mismoHorario,
  resumenHorario,
  type HorarioWeb,
} from "@/lib/horario-web";

export function InterruptorMenuTapas({ boton }: { boton: BotonMenuTapas }) {
  const id = useId();
  const {
    mostrarBotonesMenuTapas,
    botonesMenuTapasDisponibles,
    isLoading,
    isError,
    cambiarBotonMenuTapas,
    horariosMenuTapas,
    horariosDisponibles,
    cambiarHorarioMenuTapas,
  } = useConfiguracionWeb();
  const [editando, setEditando] = useState(false);
  const nombre = boton === "menu" ? "Menú del día" : "Tapas";
  const horario = horariosMenuTapas?.[boton] ?? HORARIO_POR_DEFECTO[boton];
  // Sin la explicación de qué hace el interruptor (2026-10-18, petición del dueño): se
  // entiende solo. El aviso de carga/error sí se queda, porque ahí sí hay algo que decir.
  const aviso = isLoading
    ? "Cargando..."
    : isError
      ? "No se pudo cargar la configuración."
      : !botonesMenuTapasDisponibles
        ? "Falta aplicar la actualización de configuración en la base de datos."
        : null;
  return (
    <Card data-tour="gw-menu-interruptor">
      <CardContent className="space-y-1 px-4 py-2.5">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor={id} className="cursor-pointer">Mostrar «{nombre}» en la web de Casa Tomás</Label>
          <Switch id={id} checked={mostrarBotonesMenuTapas[boton]}
            disabled={isLoading || isError || !botonesMenuTapasDisponibles || cambiarBotonMenuTapas.isPending}
            onCheckedChange={(mostrar) => cambiarBotonMenuTapas.mutate({ boton, mostrar })} />
        </div>
        {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}

        {/* Días y horas (04/11/2026, petición del dueño): el interruptor sigue mandando; encendido,
            el botón solo sale dentro de este horario. Plegado para no alargar la pestaña. */}
        {!aviso && horariosDisponibles && (
          <div className="border-t pt-1.5">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={editando}
              onClick={() => setEditando((v) => !v)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-muted-foreground">Cuándo sale: </span>
                  {resumenHorario(horario)}
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${editando ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {editando && (
              <EditorHorario
                boton={boton}
                guardado={horario}
                guardando={cambiarHorarioMenuTapas.isPending}
                onGuardar={(nuevo) =>
                  cambiarHorarioMenuTapas.mutate({ boton, horario: nuevo }, { onSuccess: () => setEditando(false) })
                }
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EditorHorario({
  boton,
  guardado,
  guardando,
  onGuardar,
}: {
  boton: BotonMenuTapas;
  guardado: HorarioWeb;
  guardando: boolean;
  onGuardar: (horario: HorarioWeb | null) => void;
}) {
  const idDesde = useId();
  const idHasta = useId();
  const idTodoElDia = useId();
  const [borrador, setBorrador] = useState<HorarioWeb>(guardado);
  // Clave estable: `guardado` es un objeto nuevo en cada pintado del padre (y la consulta se
  // refresca al volver a la pestaña); solo se rehace el borrador si cambió lo guardado de verdad.
  const claveGuardado = JSON.stringify(guardado);
  useEffect(() => setBorrador(JSON.parse(claveGuardado) as HorarioWeb), [claveGuardado]);
  const todoElDia = borrador.desde === null && borrador.hasta === null;
  const error = errorHorario(borrador);
  const porDefecto = HORARIO_POR_DEFECTO[boton];

  return (
    <div className="space-y-3 pb-2 pt-1">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Días</p>
        <ToggleGroup
          type="multiple"
          variant="outline"
          className="flex flex-wrap justify-start gap-1.5"
          value={borrador.dias.map(String)}
          onValueChange={(valores) =>
            setBorrador((b) => ({ ...b, dias: valores.map(Number).sort((x, y) => x - y) }))
          }
        >
          {DIAS_SEMANA.map((d) => (
            <ToggleGroupItem
              key={d.dia}
              value={String(d.dia)}
              aria-label={d.largo}
              title={d.largo}
              className="h-11 w-11 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {d.corto}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex min-h-11 items-center justify-between gap-4">
        <Label htmlFor={idTodoElDia} className="cursor-pointer">Todo el día</Label>
        <Switch
          id={idTodoElDia}
          checked={todoElDia}
          onCheckedChange={(valor) =>
            setBorrador((b) => (valor ? { ...b, desde: null, hasta: null } : { ...b, desde: "13:00", hasta: "16:00" }))
          }
        />
      </div>

      {!todoElDia && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={idDesde}>Aparece a las</Label>
            <Input
              id={idDesde}
              type="time"
              step={300}
              className="h-11"
              value={borrador.desde ?? ""}
              onChange={(e) => setBorrador((b) => ({ ...b, desde: e.target.value || null }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={idHasta}>Desaparece a las</Label>
            <Input
              id={idHasta}
              type="time"
              step={300}
              className="h-11"
              value={borrador.hasta ?? ""}
              onChange={(e) => setBorrador((b) => ({ ...b, hasta: e.target.value || null }))}
            />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Hora de España. Si la de desaparecer es anterior, el botón sigue hasta esa hora del día siguiente.
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Quedará: {resumenHorario(borrador)}.</p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {!mismoHorario(borrador, porDefecto) && (
          <Button type="button" variant="ghost" className="h-11" disabled={guardando} onClick={() => setBorrador(porDefecto)}>
            Volver a lo de siempre
          </Button>
        )}
        <Button
          type="button"
          className="h-11"
          disabled={guardando || error !== null || mismoHorario(borrador, guardado)}
          // Lo de siempre se guarda como NULL: si algún día cambia el valor por defecto, lo sigue.
          onClick={() => onGuardar(mismoHorario(borrador, porDefecto) ? null : borrador)}
        >
          {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar horario
        </Button>
      </div>
    </div>
  );
}
