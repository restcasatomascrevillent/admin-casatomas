import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Info, Users, ListOrdered } from "lucide-react";
// ============================================================
// El motor se importa DIRECTAMENTE — es un módulo puro (cero red, cero
// base de datos) escrito para poder correr en el navegador exactamente
// así. Esta pantalla no reimplementa ni un solo cálculo de la escalera:
// se lo pide al mismo fichero que usan la web y el teléfono.
// ============================================================
import {
  calcularDisponibilidad,
  resolverEscalera,
  horaAMinutos,
  type NivelEscalera,
  type BaseUmbral,
  type ConfiguracionTurnoInput,
  type ReservaOcupante,
} from "../../../supabase/functions/_shared/disponibilidad";
import {
  etiquetaNivelLocal,
  formatoPersonas,
  construirEscenarios,
  traducirAviso,
  MIN_NIVELES,
  MAX_NIVELES,
  FECHA_REFERENCIA_PREVIEW,
} from "./escaleraTexto";

const DESCRIPCION_BASE_UMBRAL: Record<BaseUmbral, string> = {
  reparto_nivel_base:
    "Reparte el aforo total entre las horas en punto del turno y mide cada umbral sobre esa cifra por hora. Es el modo activo hoy: con 150 plazas y 3 horas en punto en un turno, cada hora vale 50 personas.",
  aforo_total:
    "Mide cada umbral sobre el aforo COMPLETO del restaurante en vez de repartirlo por hora. Con el volumen de reservas de hoy, los niveles intermedios casi no llegan a abrirse nunca con este modo.",
};

export interface EscaleraTurnoEditorProps {
  niveles: NivelEscalera[];
  onChangeNiveles: (niveles: NivelEscalera[]) => void;
  ocultarNivelAnterior: boolean;
  onChangeOcultar: (valor: boolean) => void;
  baseUmbral: BaseUmbral;
  onChangeBaseUmbral: (valor: BaseUmbral) => void;
  horaInicio: string;
  horaFin: string;
  espacioId: string | null;
  capacidadTotal: number;
  /** `true` si esta escalera se acaba de derivar de las columnas antiguas al cambiar de pestaña. */
  migradaDeLegacy?: boolean;
}

export function EscaleraTurnoEditor({
  niveles,
  onChangeNiveles,
  ocultarNivelAnterior,
  onChangeOcultar,
  baseUmbral,
  onChangeBaseUmbral,
  horaInicio,
  horaFin,
  espacioId,
  capacidadTotal,
  migradaDeLegacy,
}: EscaleraTurnoEditorProps) {
  // --------------------------------------------------------
  // Cálculo en vivo con el motor real (memoizado: nada de esto toca red).
  // --------------------------------------------------------
  const calculo = useMemo(() => {
    const inicioMin = horaAMinutos(horaInicio);
    const finMin = horaAMinutos(horaFin);
    if (inicioMin === null || finMin === null || niveles.length === 0) return null;

    const avisosPropios = new Set<string>();
    const draft: ConfiguracionTurnoInput = {
      id: "draft",
      nombre_periodo: "Previsualización",
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      niveles_escalera: niveles,
      ocultar_nivel_anterior: ocultarNivelAnterior,
      base_umbral: baseUmbral,
      activo: true,
      espacio_id: espacioId,
    };

    const { escalera: escaleraNormalizada } = resolverEscalera(draft, avisosPropios);
    const escenarios = construirEscenarios(escaleraNormalizada);

    // Corrida a 0% de ocupación: de aquí salen el divisor (personas por
    // hora), la hora "pico" donde simular reservas, y el último tramo real
    // del nivel base tal y como lo genera el motor.
    const resultado0 = calcularDisponibilidad({
      fecha: FECHA_REFERENCIA_PREVIEW,
      comensales: 1,
      espacioId,
      configuraciones: [draft],
      reservas: [],
      capacidadTotal,
      ahora: null,
    });

    const periodo0 = resultado0.periodos[0] ?? null;
    const divisor = periodo0 ? periodo0.base_umbral_capacidad : 0;
    const horaPico = resultado0.huecos.find((h) => h.nivel === 0)?.hora ?? resultado0.huecos[0]?.hora ?? null;

    const avisosTotales = new Set<string>(avisosPropios);
    resultado0.avisos.forEach((a) => avisosTotales.add(a));

    const filas = escenarios.map((porcentaje) => {
      const personas = divisor > 0 ? Math.round((divisor * porcentaje) / 100) : 0;
      const reservas: ReservaOcupante[] =
        horaPico && personas > 0 ? [{ hora: horaPico, numero_comensales: personas, espacio_id: espacioId }] : [];
      const resultado = calcularDisponibilidad({
        fecha: FECHA_REFERENCIA_PREVIEW,
        comensales: 1,
        espacioId,
        configuraciones: [draft],
        reservas,
        capacidadTotal,
        ahora: null,
      });
      resultado.avisos.forEach((a) => avisosTotales.add(a));
      return { porcentaje, personas, huecos: resultado.huecos.filter((h) => h.ofrecido) };
    });

    // Último tramo del nivel más grueso, leído de lo que generó el motor
    // de verdad (no recalculado a mano aquí: la rejilla ancla a
    // medianoche, no al inicio del turno, así que solo el motor sabe dónde
    // cae exactamente).
    const minutosBase = escaleraNormalizada[0]?.minutos ?? null;
    const horasBase = resultado0.huecos.filter((h) => h.nivel === 0).map((h) => h.hora);
    let notaUltimoTramo: string | null = null;
    if (minutosBase && horasBase.length > 0) {
      const ultimaBase = horasBase[horasBase.length - 1];
      const ultimaMin = horaAMinutos(ultimaBase);
      if (ultimaMin !== null) {
        const finAbs = finMin > inicioMin ? finMin : finMin + 1440;
        const gap = finAbs - ultimaMin;
        if (gap > 0 && gap < minutosBase) {
          notaUltimoTramo = `El último tramo de este turno va de ${ultimaBase} a ${horaFin}: solo ${gap} min en vez de los ${minutosBase} habituales. No rompe nada, pero ese hueco no queda repartido igual que el resto.`;
        }
      }
    }

    return {
      escaleraNormalizada,
      divisor,
      horaPico,
      filas,
      avisos: Array.from(avisosTotales),
      notaUltimoTramo,
    };
  }, [horaInicio, horaFin, niveles, ocultarNivelAnterior, baseUmbral, espacioId, capacidadTotal]);

  const duplicados = useMemo(() => {
    const contados = new Map<number, number>();
    niveles.forEach((n) => contados.set(n.minutos, (contados.get(n.minutos) ?? 0) + 1));
    return contados;
  }, [niveles]);

  const minutosMax = niveles.length > 0 ? Math.max(...niveles.map((n) => n.minutos)) : null;

  const actualizarNivel = (index: number, cambios: Partial<NivelEscalera>) => {
    onChangeNiveles(niveles.map((n, i) => (i === index ? { ...n, ...cambios } : n)));
  };

  const eliminarNivel = (index: number) => {
    if (niveles.length <= MIN_NIVELES) return;
    onChangeNiveles(niveles.filter((_, i) => i !== index));
  };

  const anadirNivel = () => {
    if (niveles.length >= MAX_NIVELES) return;
    const minMinutos = Math.min(...niveles.map((n) => n.minutos));
    const nuevoMinutos = Math.max(1, Math.floor(minMinutos / 2));
    const maxUmbral = Math.max(0, ...niveles.map((n) => n.umbral));
    const nuevoUmbral = Math.min(99, maxUmbral + 10);
    onChangeNiveles([...niveles, { minutos: nuevoMinutos, umbral: nuevoUmbral }]);
  };

  return (
    <div className="space-y-5">
      {migradaDeLegacy && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Hemos traducido tu configuración actual a esta escalera para que no cambie nada al guardar. A partir de
            ahora puedes añadir, quitar o editar niveles libremente.
          </AlertDescription>
        </Alert>
      )}

      {/* --- Filas de niveles --- */}
      <div className="space-y-3">
        {niveles.map((nivel, index) => {
          const esBase = minutosMax !== null && nivel.minutos === minutosMax;
          const efectivo = calculo?.escaleraNormalizada.find((e) => e.minutos === nivel.minutos) ?? null;
          const personas = calculo && calculo.divisor > 0 && efectivo ? formatoPersonas((calculo.divisor * efectivo.umbral) / 100) : null;
          const estaDuplicado = (duplicados.get(nivel.minutos) ?? 0) > 1;

          return (
            <div key={index} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="space-y-1">
                  <Label className="text-xs">Cada</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number" inputMode="numeric"
                      min={1}
                      max={1440}
                      step={1}
                      value={nivel.minutos}
                      onChange={(e) => actualizarNivel(index, { minutos: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-20"
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground pb-2">{etiquetaNivelLocal(nivel.minutos)}</div>
                <div className="ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => eliminarNivel(index)}
                    disabled={niveles.length <= MIN_NIVELES}
                    title={niveles.length <= MIN_NIVELES ? "Tiene que quedar al menos un nivel" : "Quitar nivel"}
                    aria-label="Quitar nivel"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {esBase ? (
                <p className="text-xs text-muted-foreground">
                  Nivel más grueso: siempre está abierto (0%), sin importar la ocupación.
                </p>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">Se abre al llegar a: {nivel.umbral}%</Label>
                  <Slider
                    value={[nivel.umbral]}
                    onValueChange={(v) => actualizarNivel(index, { umbral: v[0] })}
                    min={0}
                    max={100}
                    step={1}
                  />
                  {personas && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      Se abrirá cuando esa hora junte {personas}
                      {efectivo && efectivo.umbral !== nivel.umbral ? ` (se aplicará como ${efectivo.umbral}%, no puede bajar del nivel anterior)` : ""}
                    </p>
                  )}
                  {nivel.umbral === 0 && (
                    <p className="text-xs text-muted-foreground">Con 0% este nivel estará siempre abierto, como si fuera otro nivel base.</p>
                  )}
                  {nivel.umbral === 100 && (
                    <p className="text-xs text-muted-foreground">Con 100% este nivel casi nunca se abrirá: hace falta que la hora anterior esté completamente llena.</p>
                  )}
                </div>
              )}

              {estaDuplicado && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Hay otro nivel con este mismo intervalo ({nivel.minutos} min): el motor solo usará el primero, el resto se ignora.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={anadirNivel} disabled={niveles.length >= MAX_NIVELES}>
          <Plus className="h-4 w-4 mr-1" />
          Añadir nivel
        </Button>
        {niveles.length >= MAX_NIVELES && <span className="text-xs text-muted-foreground">Máximo {MAX_NIVELES} niveles</span>}
      </div>

      {calculo && calculo.escaleraNormalizada.length > 1 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ListOrdered className="h-3.5 w-3.5" />
          El orden no depende de cómo los añadas: se aplican de más a menos minutos —{" "}
          {calculo.escaleraNormalizada.map((n) => `${n.minutos} min`).join(" → ")}.
        </p>
      )}

      <Separator />

      {/* --- ocultar_nivel_anterior --- */}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="space-y-0.5 pr-4">
          <Label>Ocultar el nivel anterior al abrirse uno nuevo</Label>
          <p className="text-sm text-muted-foreground">
            Al abrirse un nivel (p. ej. las medias), el anterior (las horas en punto) deja de ofrecerse. Si eso
            dejara el turno sin ninguna hora visible, el sistema lo ignora automáticamente y avisa.
          </p>
        </div>
        <Switch checked={ocultarNivelAnterior} onCheckedChange={onChangeOcultar} />
      </div>

      {/* --- base_umbral --- */}
      <div className="space-y-1.5">
        <Label>Sobre qué se mide el umbral</Label>
        <Select value={baseUmbral} onValueChange={(v) => onChangeBaseUmbral(v as BaseUmbral)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reparto_nivel_base">Repartido por hora (recomendado)</SelectItem>
            <SelectItem value="aforo_total">Aforo completo del restaurante</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{DESCRIPCION_BASE_UMBRAL[baseUmbral]}</p>
      </div>

      <Separator />

      {/* --- Previsualización --- */}
      <div className="space-y-3">
        <div>
          <Label className="text-base">Previsualización</Label>
          <p className="text-sm text-muted-foreground">
            Qué horas se ofrecerían con esta configuración, calculado en vivo con el motor real a distintos niveles
            de ocupación de la hora punta. El aforo que cuenta es el del restaurante completo, no solo esta zona.
          </p>
        </div>

        {!calculo ? (
          <p className="text-sm text-muted-foreground">Completa la hora de inicio y de fin para ver la previsualización.</p>
        ) : capacidadTotal <= 0 ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              No hay aforo activo entre los espacios (0 plazas), así que no se puede traducir el umbral a personas.
              Revisa el aforo en la pestaña Espacios.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {calculo.filas.map((fila) => {
              const primerExtra = fila.huecos.find((h) => h.nivel > 0 && h.abierto_por);
              return (
                <div key={fila.porcentaje} className="rounded-lg border p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {fila.porcentaje}% de ocupación{calculo.horaPico ? ` (${formatoPersonas(fila.personas)} a las ${calculo.horaPico})` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {fila.huecos.map((h) => (
                      <Badge key={h.hora} variant={h.nivel === 0 ? "outline" : "secondary"}>
                        {h.hora}
                      </Badge>
                    ))}
                    {fila.huecos.length === 0 && <span className="text-xs text-muted-foreground">Ninguna hora ofrecida</span>}
                  </div>
                  {primerExtra && (
                    <p className="text-xs text-muted-foreground">
                      {primerExtra.hora} se abrió porque {primerExtra.abierto_por} llegó al {primerExtra.abierto_con_porcentaje}%.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {calculo?.notaUltimoTramo && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>{calculo.notaUltimoTramo}</AlertDescription>
          </Alert>
        )}

        {calculo && calculo.avisos.length > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc list-inside space-y-1">
                {calculo.avisos.map((codigo) => (
                  <li key={codigo}>{traducirAviso(codigo)}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
