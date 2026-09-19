import { useState, useEffect, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Loader2,
    Phone,
    Bot,
    Calendar,
    Plus,
    Trash2,
    MessageSquare,
    RotateCcw,
    Save,
    Settings,
    BarChart3,
    PhoneCall,
    BellRing,
    Info,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { VapiPromptEditor } from "@/components/VapiPromptEditor";
import { VapiCallSimulator } from "@/components/VapiCallSimulator";

// Telefonía dashboard components
import { TelefoniaKpiCards } from "@/components/telefonia/TelefoniaKpiCards";
import { TelefoniaIntentChart } from "@/components/telefonia/TelefoniaIntentChart";
import { TelefoniaSentimentChart } from "@/components/telefonia/TelefoniaSentimentChart";
import { TelefoniaEndedReasonChart } from "@/components/telefonia/TelefoniaEndedReasonChart";
import { TelefoniaCallsTimeline } from "@/components/telefonia/TelefoniaCallsTimeline";
import { TelefoniaMotivoFalloChart } from "@/components/telefonia/TelefoniaMotivoFalloChart";
import { TelefoniaRecentCallsTable } from "@/components/telefonia/TelefoniaRecentCallsTable";
import { TelefoniaCallDetailDialog } from "@/components/telefonia/TelefoniaCallDetailDialog";
import { TelefoniaDateRangePicker } from "@/components/telefonia/TelefoniaDateRangePicker";
import { TelefoniaFilters } from "@/components/telefonia/TelefoniaFilters";
import type { CallLogFilters, DateRange, PresetRange } from "@/components/telefonia/types";

// Hooks (creados por el otro agente — si aún no existen, el build fallará hasta
// que se integren. Los nombres son fijos por contrato.)
import { useCallLogs } from "@/hooks/useCallLogs";
import { useCallLogsAnalytics } from "@/hooks/useCallLogsAnalytics";

// ── Config fetcher ──────────────────────────────────────────────────────────
async function getPhoneConfig() {
    const { data, error } = await supabase
        .from("phone_system_config")
        .select("*")
        .eq("restaurant_id", "default")
        .single();
    if (error) throw error;
    return data;
}

// ── Respuestas del bot — textos por defecto ─────────────────────────────────
const DEFAULT_BOT_RESPONSES: Record<string, string> = {
    transfer_to_human: 'Un momento, ahora mismo te paso con el restaurante.',
    availability_found: 'Perfecto, hay disponibilidad el {fecha} a las {hora} para {comensales} personas. Espacios disponibles: {espacios}. ¿Procedemos con la reserva? Solo necesito tu nombre.',
    availability_not_found: 'Vaya, lo siento — no tenemos hueco el {fecha} a las {hora} para {comensales} personas. ¿Quieres probar con otra fecha u hora?',
    reservation_created: 'Listo, {nombre}, ya tengo anotada tu reserva para {comensales} personas el {fecha} a las {hora}{notas_texto}. Quedará pendiente de confirmación — te llamaremos para dártela por buena. ¿En qué más puedo ayudarte?',
    reservation_blacklist: 'Lo siento, en este momento no podemos tramitar tu reserva por teléfono. Te animamos a contactarnos por otro medio.',
    reservation_group_large: 'Para una mesa de más de {max} personas es mejor que lo gestionemos de forma personalizada. Dejo tu consulta anotada y alguien del restaurante te llama para encontrar la mejor opción. ¿Te parece bien?',
    reservation_today: 'Entiendo que necesitas mesa para hoy, pero las reservas del día se gestionan directamente en el restaurante. He dejado tu petición anotada por si pueden ayudarte. ¿Puedo hacer algo más por ti?',
    reservation_cutoff: 'Mira, el tiempo es justo — las reservas tienen que hacerse con al menos {minutos} minutos de antelación. He anotado tu petición para que el restaurante lo sepa. ¿Quieres probar con otro día?',
    reservation_max_phone: 'Ya tienes {max} reserva(s) activa(s) para ese día con este número. He anotado la petición para que el equipo del restaurante lo vea. ¿Puedo ayudarte con otra cosa?',
    reservation_max_email: 'Ya se ha alcanzado el límite de reservas para ese día con ese email. He dejado tu consulta anotada. ¿Necesitas algo más?',
    reservation_no_availability: 'Lo siento, ya no queda disponibilidad el {fecha} a las {hora} para {comensales} personas. He anotado tu petición por si surge algún hueco. ¿Quieres que mire otra fecha?',
    reservation_no_phone: 'Necesito un número de teléfono de contacto para la reserva. ¿Puedes facilitarme uno o llamar desde un número visible?',
    reservation_error: 'Vaya, ha habido un problema al registrar la reserva. ¿Lo intentamos de nuevo, o prefieres llamar directamente al restaurante?',
    find_no_phone: 'No puedo verificar tu número. Por favor, llama desde el teléfono con el que hiciste la reserva.',
    find_not_found: 'No encuentro reservas activas para este número{fecha_texto}. ¿Puede que la reserva estuviera a otro nombre o teléfono?',
    find_found_one: 'Aquí tienes tu reserva: {fecha} a las {hora}, {comensales} personas{espacio_texto}, a nombre de {nombre} — estado: {estado}. [REF_INTERNA:{id}] ¿Quieres modificarla o cancelarla?',
    find_found_many: 'Tienes {cantidad} reservas activas:\n{lista}\n¿Cuál te gustaría modificar o cancelar? Dime la fecha o el número.',
    find_error: 'Ha habido un problema buscando tus reservas. Inténtalo de nuevo o llama al restaurante.',
    modify_not_found: 'No encuentro esa reserva, o puede que ya no esté activa.',
    modify_24h: 'Lo siento, los cambios hay que hacerlos con más de 24 horas de antelación. Para urgencias, llama directamente al restaurante.',
    modify_no_availability: 'No hay disponibilidad el {fecha} para {comensales} personas. ¿Probamos con otra fecha?',
    modify_success: 'Hecho, he actualizado tu reserva ({cambios}). Queda pendiente de confirmación — el restaurante te avisará. ¿Algo más?',
    modify_error: 'No he podido modificar la reserva. ¿Lo intentamos de nuevo o prefieres llamar al restaurante?',
    cancel_not_found: 'No encuentro esa reserva, o puede que ya no esté activa.',
    cancel_24h: 'Los cambios hay que hacerlos con más de 24 horas de antelación. Para urgencias, llama directamente al restaurante.',
    cancel_success: 'Tu reserva del {fecha} a las {hora} para {comensales} personas ha quedado cancelada. ¿Puedo ayudarte en algo más?',
    cancel_error: 'No he podido cancelar la reserva. ¿Lo intentamos de nuevo o prefieres llamar al restaurante?',
    validation_date_past: 'No se puede reservar para una fecha ya pasada.',
    validation_date_today: 'Las reservas para hoy se gestionan directamente en el restaurante. ¿Quieres que anote tu petición?',
    validation_date_too_far: 'Solo podemos aceptar reservas con un máximo de {dias} días de antelación.',
    validation_cutoff: 'Las reservas deben hacerse con al menos {minutos} minutos de antelación. ¿Quieres que anote tu petición?',
    validation_party_range: 'El número de comensales debe estar entre {min} y {max} personas.',
    transfer_call: 'Te paso con el restaurante, un momento.',
};

const BOT_RESPONSE_GROUPS: { label: string; keys: string[] }[] = [
    { label: 'General', keys: ['transfer_to_human', 'transfer_call'] },
    { label: 'Disponibilidad', keys: ['availability_found', 'availability_not_found'] },
    {
        label: 'Crear reserva', keys: [
            'reservation_created', 'reservation_blacklist', 'reservation_group_large',
            'reservation_today', 'reservation_cutoff', 'reservation_max_phone',
            'reservation_max_email', 'reservation_no_availability', 'reservation_no_phone', 'reservation_error',
        ],
    },
    { label: 'Buscar reserva', keys: ['find_no_phone', 'find_not_found', 'find_found_one', 'find_found_many', 'find_error'] },
    { label: 'Modificar reserva', keys: ['modify_not_found', 'modify_24h', 'modify_no_availability', 'modify_success', 'modify_error'] },
    { label: 'Cancelar reserva', keys: ['cancel_not_found', 'cancel_24h', 'cancel_success', 'cancel_error'] },
    { label: 'Validaciones', keys: ['validation_date_past', 'validation_date_today', 'validation_date_too_far', 'validation_cutoff', 'validation_party_range'] },
];

const BOT_RESPONSE_LABELS: Record<string, string> = {
    transfer_to_human: 'Transferir a humano', transfer_call: 'Pasar llamada',
    availability_found: 'Hay disponibilidad', availability_not_found: 'Sin disponibilidad',
    reservation_created: 'Reserva creada', reservation_blacklist: 'Cliente en blacklist',
    reservation_group_large: 'Grupo demasiado grande', reservation_today: 'Reserva para hoy',
    reservation_cutoff: 'Demasiado tarde (corte horario)', reservation_max_phone: 'Límite por teléfono',
    reservation_max_email: 'Límite por email', reservation_no_availability: 'Sin disponibilidad al crear',
    reservation_no_phone: 'Sin teléfono', reservation_error: 'Error al crear reserva',
    find_no_phone: 'Sin número verificado', find_not_found: 'Reserva no encontrada',
    find_found_one: 'Una reserva encontrada', find_found_many: 'Varias reservas', find_error: 'Error al buscar',
    modify_not_found: 'Reserva no encontrada (modificar)', modify_24h: 'Regla 24h (modificar)',
    modify_no_availability: 'Sin disponibilidad (modificar)', modify_success: 'Modificación exitosa', modify_error: 'Error al modificar',
    cancel_not_found: 'Reserva no encontrada (cancelar)', cancel_24h: 'Regla 24h (cancelar)',
    cancel_success: 'Cancelación exitosa', cancel_error: 'Error al cancelar',
    validation_date_past: 'Fecha pasada', validation_date_today: 'Fecha hoy',
    validation_date_too_far: 'Fecha demasiado lejana', validation_cutoff: 'Corte horario (validación)',
    validation_party_range: 'Rango de comensales',
};

const BOT_RESPONSE_VARS: Record<string, string> = {
    availability_found: '{fecha}, {hora}, {comensales}, {espacios}',
    availability_not_found: '{fecha}, {hora}, {comensales}',
    reservation_created: '{nombre}, {fecha}, {hora}, {comensales}, {notas_texto}',
    reservation_group_large: '{max}', reservation_cutoff: '{minutos}',
    reservation_max_phone: '{max}', reservation_max_email: '{max}',
    reservation_no_availability: '{fecha}, {hora}, {comensales}',
    find_not_found: '{fecha_texto}',
    find_found_one: '{fecha}, {hora}, {comensales}, {espacio_texto}, {nombre}, {estado}, {id}',
    find_found_many: '{cantidad}, {lista}',
    modify_no_availability: '{fecha}, {comensales}', modify_success: '{cambios}',
    validation_date_too_far: '{dias}', validation_cutoff: '{minutos}',
    validation_party_range: '{min}, {max}',
};

// ── Helpers rango ───────────────────────────────────────────────────────────
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function defaultRange(): DateRange {
    const now = new Date();
    return {
        dateFrom: startOfDay(new Date(now.getTime() - 6 * 86400000)),
        dateTo: endOfDay(now),
    };
}

export default function AsistenteTelefonico() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // ── Estado del dashboard ────────────────────────────────────────────────
    const [range, setRange] = useState<DateRange>(defaultRange());
    const [preset, setPreset] = useState<PresetRange>("7d");
    const [filters, setFilters] = useState<CallLogFilters>({
        intent: "all",
        sentiment: "all",
        success: "all",
        callType: "all",
    });
    const [selectedCall, setSelectedCall] = useState<any | null>(null);

    // ── Queries dashboard ───────────────────────────────────────────────────
    const { data: analytics, isLoading: isLoadingAnalytics } = useCallLogsAnalytics({
        dateFrom: range.dateFrom.toISOString(),
        dateTo: range.dateTo.toISOString(),
        callType: filters.callType === "all" ? undefined : filters.callType,
    });

    const { data: calls = [], isLoading: isLoadingCalls } = useCallLogs({
        dateFrom: range.dateFrom.toISOString(),
        dateTo: range.dateTo.toISOString(),
        intent: filters.intent === "all" ? undefined : filters.intent,
        sentiment: filters.sentiment === "all" ? undefined : filters.sentiment,
        success: filters.success === "all" ? undefined : filters.success,
        callType: filters.callType === "all" ? undefined : filters.callType,
    });

    // ── Config query (para la pestaña de configuración) ─────────────────────
    const { data: config, isLoading: isLoadingConfig } = useQuery({
        queryKey: ["phoneConfig"],
        queryFn: getPhoneConfig,
    });

    // ── Notificaciones tipo 'llamada' para tab Alertas ──────────────────────
    const { data: alertNotifs = [] } = useQuery({
        queryKey: ["notificacionesLlamada"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("notificaciones_dashboard")
                .select("*")
                .eq("tipo", "llamada")
                .order("created_at", { ascending: false })
                .limit(20);
            if (error) return [] as any[];
            return data || [];
        },
    });

    // ═════════════════════════════════════════════════════════════════════════
    // Estado Configuración (horario + bot responses)
    // ═════════════════════════════════════════════════════════════════════════
    const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const genId = () => Math.random().toString(36).substring(2, 9);
    const DEFAULT_SCHEDULE = DAY_NAMES.map((_, i) => ({
        day: i,
        ranges: i === 1 ? [] : [{ id: genId(), start: "09:30", end: "23:00", mode: "human" }]
    }));

    const [schedule, setSchedule] = useState<any[]>(DEFAULT_SCHEDULE);
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleDirty, setScheduleDirty] = useState(false);
    const [botResponses, setBotResponses] = useState<Record<string, string>>({});
    const [botResponsesDirty, setBotResponsesDirty] = useState(false);
    const [openBotGroup, setOpenBotGroup] = useState<string | null>(null);

    const normalizeSchedule = (rawSchedule: any[]) => {
        if (!rawSchedule) return DEFAULT_SCHEDULE;
        return DAY_NAMES.map((_, i) => {
            const existing = rawSchedule.find(r => r.day === i);
            if (!existing) return { day: i, ranges: [] };
            if (!existing.ranges) {
                if (existing.start && existing.end) {
                    return { day: i, ranges: [{ id: genId(), start: existing.start, end: existing.end, mode: existing.mode || "human" }] };
                } else if (existing.mode === "human") {
                    return { day: i, ranges: [{ id: genId(), start: "00:00", end: "23:59", mode: "human" }] };
                } else { return { day: i, ranges: [] }; }
            }
            const ranges = existing.ranges.map((r: any) => ({ ...r, id: r.id || genId() }));
            return { ...existing, ranges };
        });
    };

    useEffect(() => {
        if (config) {
            setScheduleEnabled((config as any).schedule_enabled ?? false);
            const s = (config as any).schedule;
            if (s && Array.isArray(s) && s.length > 0) setSchedule(normalizeSchedule(s));
            else setSchedule(normalizeSchedule(DEFAULT_SCHEDULE));
            const br = (config as any).bot_responses;
            setBotResponses(br && typeof br === 'object' ? br : {});
            setBotResponsesDirty(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config]);

    const updateModeMutation = useMutation({
        mutationFn: async (newMode: string) => {
            const { error } = await supabase
                .from("phone_system_config")
                .update({ mode: newMode })
                .eq("restaurant_id", "default");
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["phoneConfig"] });
            toast({ title: "Modo actualizado", description: "El modo se ha guardado correctamente." });
        },
        onError: () => toast({ title: "Error", description: "No se pudo actualizar el modo.", variant: "destructive" }),
    });

    const updateScheduleMutation = useMutation({
        mutationFn: async ({ enabled, rules }: { enabled: boolean; rules: any[] }) => {
            const { error } = await supabase
                .from("phone_system_config")
                .update({ schedule_enabled: enabled, schedule: rules } as any)
                .eq("restaurant_id", "default");
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["phoneConfig"] });
            setScheduleDirty(false);
            toast({ title: "Horario guardado", description: "Los horarios se han actualizado." });
        },
        onError: () => toast({ title: "Error", description: "No se pudo guardar el horario.", variant: "destructive" }),
    });

    const updateBotResponsesMutation = useMutation({
        mutationFn: async (responses: Record<string, string>) => {
            const { error } = await supabase
                .from("phone_system_config")
                .update({ bot_responses: responses } as any)
                .eq("restaurant_id", "default");
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["phoneConfig"] });
            setBotResponsesDirty(false);
            toast({ title: "Respuestas guardadas", description: "Los textos se han actualizado." });
        },
        onError: () => toast({ title: "Error", description: "No se pudieron guardar los textos.", variant: "destructive" }),
    });

    const addRange = (dayIndex: number) => {
        setSchedule(prev => prev.map(rule => rule.day === dayIndex
            ? { ...rule, ranges: [...(rule.ranges || []), { id: genId(), start: "12:00", end: "16:00", mode: "human" }] }
            : rule));
        setScheduleDirty(true);
    };
    const removeRange = (dayIndex: number, rangeId: string) => {
        setSchedule(prev => prev.map(rule => rule.day === dayIndex && rule.ranges
            ? { ...rule, ranges: rule.ranges.filter((r: any) => r.id !== rangeId) }
            : rule));
        setScheduleDirty(true);
    };
    const updateRangeRule = (dayIndex: number, rangeId: string, field: string, value: string) => {
        setSchedule(prev => prev.map(rule => rule.day === dayIndex && rule.ranges
            ? { ...rule, ranges: rule.ranges.map((r: any) => r.id === rangeId ? { ...r, [field]: value } : r) }
            : rule));
        setScheduleDirty(true);
    };

    const handleModeChange = (checked: boolean) => updateModeMutation.mutate(checked ? "bot" : "human");
    const handleScheduleToggle = (checked: boolean) => {
        setScheduleEnabled(checked);
        updateScheduleMutation.mutate({ enabled: checked, rules: schedule });
    };
    const saveSchedule = () => updateScheduleMutation.mutate({ enabled: scheduleEnabled, rules: schedule });

    // ── KPI header badge: modo actual ───────────────────────────────────────
    const modeBadge = useMemo(() => {
        if (isLoadingConfig) return null;
        const mode = (config as any)?.mode;
        return (
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5">
                <Switch
                    id="mode-switch-header"
                    checked={mode === "bot"}
                    onCheckedChange={handleModeChange}
                    disabled={updateModeMutation.isPending}
                />
                <Label htmlFor="mode-switch-header" className="text-xs font-medium">
                    {mode === "bot" ? "🤖 Bot IA" : "👤 Humano"}
                </Label>
            </div>
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config, isLoadingConfig, updateModeMutation.isPending]);

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Asistente Telefónico</h2>
                        <p className="text-muted-foreground text-sm">
                            Monitorización en tiempo real del bot de voz y la atención telefónica.
                        </p>
                    </div>
                    {modeBadge}
                </div>

                <Tabs defaultValue="resumen" className="w-full">
                    <TabsList className="w-full sm:w-auto bg-muted/80 p-1.5 h-auto gap-1 flex-wrap">
                        <TabsTrigger value="resumen" className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all">
                            <BarChart3 className="h-4 w-4" /> Resumen
                        </TabsTrigger>
                        <TabsTrigger value="llamadas" className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all">
                            <PhoneCall className="h-4 w-4" /> Llamadas
                        </TabsTrigger>
                        <TabsTrigger value="alertas" className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all">
                            <BellRing className="h-4 w-4" /> Alertas
                        </TabsTrigger>
                        <TabsTrigger value="configuracion" className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all">
                            <Settings className="h-4 w-4" /> Configuración
                        </TabsTrigger>
                    </TabsList>

                    {/* ═══════════ RESUMEN ═══════════ */}
                    <TabsContent value="resumen" className="space-y-6 mt-6">
                        <div className="flex justify-end">
                            <TelefoniaDateRangePicker
                                value={range}
                                preset={preset}
                                onChange={(r, p) => { setRange(r); setPreset(p); }}
                            />
                        </div>

                        <TelefoniaKpiCards analytics={analytics} isLoading={isLoadingAnalytics} />

                        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                            <TelefoniaIntentChart data={analytics?.byIntent} isLoading={isLoadingAnalytics} />
                            <TelefoniaSentimentChart data={analytics?.bySentiment} isLoading={isLoadingAnalytics} />
                            <TelefoniaEndedReasonChart data={analytics?.byEndedReason} isLoading={isLoadingAnalytics} />
                            <TelefoniaMotivoFalloChart data={analytics?.byMotivoFallo} isLoading={isLoadingAnalytics} />
                        </div>

                        <TelefoniaCallsTimeline data={analytics?.callsPerDay} isLoading={isLoadingAnalytics} />
                    </TabsContent>

                    {/* ═══════════ LLAMADAS ═══════════ */}
                    <TabsContent value="llamadas" className="space-y-4 mt-6">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                            <TelefoniaFilters value={filters} onChange={setFilters} />
                            <TelefoniaDateRangePicker
                                value={range}
                                preset={preset}
                                onChange={(r, p) => { setRange(r); setPreset(p); }}
                            />
                        </div>

                        <TelefoniaRecentCallsTable
                            calls={calls}
                            isLoading={isLoadingCalls}
                            onSelect={setSelectedCall}
                        />
                    </TabsContent>

                    {/* ═══════════ ALERTAS ═══════════ */}
                    <TabsContent value="alertas" className="space-y-4 mt-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <BellRing className="h-5 w-5" /> Alertas de telefonía
                                </CardTitle>
                                <CardDescription>
                                    Eventos e incidencias detectadas en el flujo de llamadas.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {alertNotifs.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 text-center gap-3 text-muted-foreground">
                                        <Info className="h-10 w-10 opacity-40" />
                                        <p className="text-sm">
                                            No hay alertas activas en este momento.
                                        </p>
                                        <p className="text-xs max-w-md">
                                            Próximamente: monitores de VAPI en tiempo real — latencia, tasa de error
                                            del webhook y saturación de llamadas.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {alertNotifs.map((n: any) => (
                                            <div
                                                key={n.id}
                                                className="flex items-start gap-3 p-3 border rounded-md bg-card"
                                            >
                                                <BellRing className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium">{n.titulo || "Alerta"}</div>
                                                    {n.mensaje && (
                                                        <div className="text-xs text-muted-foreground mt-0.5">
                                                            {n.mensaje}
                                                        </div>
                                                    )}
                                                </div>
                                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                                    {new Intl.DateTimeFormat("es-ES", {
                                                        day: "2-digit",
                                                        month: "short",
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    }).format(new Date(n.created_at))}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ═══════════ CONFIGURACIÓN ═══════════ */}
                    <TabsContent value="configuracion" className="space-y-6 mt-6">
                        {/* Horario programado */}
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <Calendar className="h-5 w-5" /> Horario Programado
                                        </CardTitle>
                                        <CardDescription>
                                            Conmuta automáticamente entre bot y humano según el día y la hora.
                                            {scheduleEnabled && " (Activo — el toggle manual se ignora)"}
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Switch checked={scheduleEnabled} onCheckedChange={handleScheduleToggle} />
                                        <Label className="text-sm">{scheduleEnabled ? "Activo" : "Inactivo"}</Label>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    {DAY_NAMES.map((name, dayIndex) => {
                                        const defaultRule = { day: dayIndex, ranges: [] };
                                        const rule = schedule.find((r: any) => r.day === dayIndex) || defaultRule;
                                        return (
                                            <div key={dayIndex} className={`p-4 rounded-lg border bg-card transition-opacity ${!scheduleEnabled ? "opacity-50" : ""}`}>
                                                <div className="flex items-center justify-between mb-3">
                                                    <h4 className="font-medium text-sm sm:text-base">{name}</h4>
                                                    <Button variant="outline" size="sm" onClick={() => addRange(dayIndex)} disabled={!scheduleEnabled} className="h-8 shadow-sm">
                                                        <Plus className="w-3 h-3 mr-1" /> Añadir franja
                                                    </Button>
                                                </div>
                                                {(!rule.ranges || rule.ranges.length === 0) ? (
                                                    <div className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-md border border-dashed flex flex-col sm:flex-row items-center justify-center gap-2">
                                                        <Bot className="w-4 h-4 text-blue-500" />
                                                        <span>Fuera de franjas, <span className="font-medium text-foreground">Bot IA</span> responde las llamadas.</span>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {rule.ranges.map((r: any) => (
                                                            <div key={r.id} className={`flex flex-col sm:flex-row gap-3 items-start sm:items-center p-2 rounded-md border ${r.mode === "bot" ? "bg-blue-50/50 border-blue-100 dark:bg-blue-950/20 dark:border-blue-900/40" : "bg-green-50/50 border-green-100 dark:bg-green-950/20 dark:border-green-900/40"}`}>
                                                                <Select value={r.mode} onValueChange={(v) => updateRangeRule(dayIndex, r.id, "mode", v)} disabled={!scheduleEnabled}>
                                                                    <SelectTrigger className="w-full sm:w-[140px] h-9 bg-background"><SelectValue /></SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="human">👤 Humano</SelectItem>
                                                                        <SelectItem value="bot">🤖 Bot IA</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                                                    <Input type="time" value={r.start} onChange={(e) => updateRangeRule(dayIndex, r.id, "start", e.target.value)} disabled={!scheduleEnabled} className="h-9 w-full sm:w-auto bg-background" />
                                                                    <span className="text-muted-foreground text-sm">a</span>
                                                                    <Input type="time" value={r.end} onChange={(e) => updateRangeRule(dayIndex, r.id, "end", e.target.value)} disabled={!scheduleEnabled} className="h-9 w-full sm:w-auto bg-background" />
                                                                </div>
                                                                <Button variant="ghost" size="icon" className="text-destructive h-9 w-9 sm:ml-auto hover:bg-destructive/10" onClick={() => removeRange(dayIndex, r.id)} disabled={!scheduleEnabled}>
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                {scheduleDirty && (
                                    <Button className="mt-6 w-full shadow-sm" onClick={saveSchedule} disabled={updateScheduleMutation.isPending}>
                                        {updateScheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                        Guardar horarios
                                    </Button>
                                )}
                            </CardContent>
                        </Card>

                        <div className="grid gap-6 md:grid-cols-2">
                            <VapiCallSimulator assistantId={(config as any)?.vapi_assistant_id} />
                            <VapiPromptEditor config={config} />
                        </div>

                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <MessageSquare className="h-5 w-5" /> Respuestas del Bot
                                        </CardTitle>
                                        <CardDescription>
                                            Personaliza los textos del asistente. Usa {"{variable}"} como placeholder.
                                        </CardDescription>
                                    </div>
                                    {botResponsesDirty && (
                                        <Button onClick={() => updateBotResponsesMutation.mutate(botResponses)} disabled={updateBotResponsesMutation.isPending} className="shrink-0">
                                            {updateBotResponsesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                            Guardar respuestas
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {BOT_RESPONSE_GROUPS.map((group) => (
                                    <div key={group.label} className="border rounded-lg overflow-hidden">
                                        <button
                                            className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
                                            onClick={() => setOpenBotGroup(openBotGroup === group.label ? null : group.label)}
                                        >
                                            <span className="font-medium text-sm">{group.label}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {group.keys.filter(k => botResponses[k]).length}/{group.keys.length} personalizados
                                            </span>
                                        </button>
                                        {openBotGroup === group.label && (
                                            <div className="divide-y">
                                                {group.keys.map((key) => (
                                                    <div key={key} className="p-4 space-y-2">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div>
                                                                <label className="text-sm font-medium">{BOT_RESPONSE_LABELS[key] || key}</label>
                                                                {BOT_RESPONSE_VARS[key] && (
                                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                                        Variables: <code className="bg-muted px-1 rounded">{BOT_RESPONSE_VARS[key]}</code>
                                                                    </p>
                                                                )}
                                                            </div>
                                                            {botResponses[key] && (
                                                                <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0 text-muted-foreground hover:text-foreground"
                                                                    onClick={() => {
                                                                        const newBR = { ...botResponses };
                                                                        delete newBR[key];
                                                                        setBotResponses(newBR);
                                                                        setBotResponsesDirty(true);
                                                                    }}>
                                                                    <RotateCcw className="h-3 w-3 mr-1" /> Restaurar
                                                                </Button>
                                                            )}
                                                        </div>
                                                        <Textarea
                                                            rows={2}
                                                            placeholder={DEFAULT_BOT_RESPONSES[key]}
                                                            value={botResponses[key] || ''}
                                                            onChange={(e) => {
                                                                setBotResponses(prev => ({ ...prev, [key]: e.target.value }));
                                                                setBotResponsesDirty(true);
                                                            }}
                                                            className="text-sm resize-none"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                <TelefoniaCallDetailDialog call={selectedCall} onClose={() => setSelectedCall(null)} />
            </div>
        </DashboardLayout>
    );
}
