import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Phone, PhoneCall, Bot, User, Clock, Info, Search, ListFilter, Calendar, Plus, Trash2, Euro, MessageSquare, RotateCcw, Save, Settings, BarChart3 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { VapiPromptEditor } from "@/components/VapiPromptEditor";
import { VapiCallSimulator } from "@/components/VapiCallSimulator";

// Fetchers
async function getPhoneConfig() {
    const { data, error } = await supabase
        .from("phone_system_config")
        .select("*")
        .eq("restaurant_id", "default")
        .single();
    if (error) throw error;
    return data;
}

async function getCallLogs() {
    const { data, error } = await supabase
        .from("call_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(100);
    if (error) throw error;
    return data;
}

function formatDuration(seconds: number | null, startedAt: string, status: string) {
    let secs = seconds;
    if (status === 'active' && startedAt) {
        secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    }
    if (secs === null || secs === undefined) return '—';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Respuestas del bot — textos por defecto (espejo de vapi-webhook.js) ───────
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

// Razón de fin de llamada → etiqueta legible
const ENDED_REASON_LABELS: Record<string, { label: string; color: string }> = {
    'customer-ended-call': { label: 'Cliente colgó', color: 'bg-gray-100 text-gray-700' },
    'assistant-ended-call': { label: 'Bot despidió', color: 'bg-blue-100 text-blue-700' },
    'silence-timed-out': { label: 'Silencio', color: 'bg-yellow-100 text-yellow-700' },
    'max-duration-exceeded': { label: 'Duración máx.', color: 'bg-orange-100 text-orange-700' },
    'exceeded-max-duration': { label: 'Duración máx.', color: 'bg-orange-100 text-orange-700' },
    'pipeline-error': { label: 'Error pipeline', color: 'bg-red-100 text-red-700' },
    'assistant-error': { label: 'Error bot', color: 'bg-red-100 text-red-700' },
    'voicemail': { label: 'Buzón voz', color: 'bg-purple-100 text-purple-700' },
    'error': { label: 'Error', color: 'bg-red-100 text-red-700' },
};

const COST_COMPONENT_LABELS: Record<string, string> = {
    model: 'Modelo IA', transcriber: 'Transcripción', voice: 'Voz (ElevenLabs)',
    vapi: 'VAPI', telephony: 'Telefonía',
};

export default function AsistenteTelefonico() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [selectedCall, setSelectedCall] = useState<any | null>(null);

    // Queries
    const { data: config, isLoading: isLoadingConfig } = useQuery({
        queryKey: ["phoneConfig"],
        queryFn: getPhoneConfig,
    });

    const { data: calls = [], isLoading: isLoadingCalls } = useQuery({
        queryKey: ["callLogs"],
        queryFn: getCallLogs,
        refetchInterval: 5000, // Refrescar cada 5s para ver llamadas y duraciones
    });

    // Schedule state
    const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

    // Generador de ID corto local
    const genId = () => Math.random().toString(36).substring(2, 9);

    const DEFAULT_SCHEDULE = DAY_NAMES.map((name, i) => ({
        day: i,
        ranges: i === 1 ? [] : [{ id: genId(), start: "09:30", end: "23:00", mode: "human" }]
    }));

    const [schedule, setSchedule] = useState<any[]>(DEFAULT_SCHEDULE);
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleDirty, setScheduleDirty] = useState(false);

    // Bot responses editor state
    const [botResponses, setBotResponses] = useState<Record<string, string>>({});
    const [botResponsesDirty, setBotResponsesDirty] = useState(false);
    const [openBotGroup, setOpenBotGroup] = useState<string | null>(null);

    const normalizeSchedule = (rawSchedule: any[]) => {
        if (!rawSchedule) return DEFAULT_SCHEDULE;
        return DAY_NAMES.map((name, i) => {
            const existing = rawSchedule.find(r => r.day === i);
            if (!existing) return { day: i, ranges: [] };

            // Backward compatibility para datos viejos
            if (!existing.ranges) {
                if (existing.start && existing.end) {
                    return { day: i, ranges: [{ id: genId(), start: existing.start, end: existing.end, mode: existing.mode || "human" }] };
                } else if (existing.mode === "human") {
                    return { day: i, ranges: [{ id: genId(), start: "00:00", end: "23:59", mode: "human" }] };
                } else {
                    return { day: i, ranges: [] };
                }
            }

            // Asegurar que cada rango tiene id
            const ranges = existing.ranges.map((r: any) => ({
                ...r,
                id: r.id || genId()
            }));

            return { ...existing, ranges };
        });
    };

    useEffect(() => {
        if (config) {
            setScheduleEnabled((config as any).schedule_enabled ?? false);
            const s = (config as any).schedule;
            if (s && Array.isArray(s) && s.length > 0) {
                setSchedule(normalizeSchedule(s));
            } else {
                setSchedule(normalizeSchedule(DEFAULT_SCHEDULE));
            }
            // Load saved bot responses
            const br = (config as any).bot_responses;
            setBotResponses(br && typeof br === 'object' ? br : {});
            setBotResponsesDirty(false);
        }
    }, [config]);

    // Mutations
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
            toast({
                title: "Modo actualizado",
                description: "El modo del asistente telefónico se ha guardado correctamente.",
            });
        },
        onError: (error) => {
            toast({
                title: "Error",
                description: "No se pudo actualizar el modo.",
                variant: "destructive",
            });
            console.error(error);
        },
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
            toast({ title: "Horario guardado", description: "Los horarios de conmutación se han actualizado." });
        },
        onError: (error) => {
            toast({ title: "Error", description: "No se pudo guardar el horario.", variant: "destructive" });
            console.error(error);
        },
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
            toast({ title: "Respuestas guardadas", description: "Los textos del bot se han actualizado correctamente." });
        },
        onError: () => {
            toast({ title: "Error", description: "No se pudieron guardar los textos.", variant: "destructive" });
        },
    });

    const handleModeChange = (checked: boolean) => {
        updateModeMutation.mutate(checked ? "bot" : "human");
    };

    const handleScheduleToggle = (checked: boolean) => {
        setScheduleEnabled(checked);
        updateScheduleMutation.mutate({ enabled: checked, rules: schedule });
    };

    // Funciones Helper para Rangos
    const addRange = (dayIndex: number) => {
        setSchedule(prev => prev.map(rule => {
            if (rule.day === dayIndex) {
                const newRanges = [...(rule.ranges || []), { id: genId(), start: "12:00", end: "16:00", mode: "human" }];
                return { ...rule, ranges: newRanges };
            }
            return rule;
        }));
        setScheduleDirty(true);
    };

    const removeRange = (dayIndex: number, rangeId: string) => {
        setSchedule(prev => prev.map(rule => {
            if (rule.day === dayIndex && rule.ranges) {
                return { ...rule, ranges: rule.ranges.filter((r: any) => r.id !== rangeId) };
            }
            return rule;
        }));
        setScheduleDirty(true);
    };

    const updateRangeRule = (dayIndex: number, rangeId: string, field: string, value: string) => {
        setSchedule(prev => prev.map(rule => {
            if (rule.day === dayIndex && rule.ranges) {
                return {
                    ...rule,
                    ranges: rule.ranges.map((r: any) => r.id === rangeId ? { ...r, [field]: value } : r)
                };
            }
            return rule;
        }));
        setScheduleDirty(true);
    };

    const saveSchedule = () => {
        updateScheduleMutation.mutate({ enabled: scheduleEnabled, rules: schedule });
    };

    const isLoading = isLoadingConfig || isLoadingCalls;

    // Stats (calculados usando la zona horaria de Madrid)
    const todayMadrid = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

    const todayCalls = calls.filter((c: any) => {
        if (!c.started_at) return false;
        const callDateMadrid = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(c.started_at));
        return callDateMadrid === todayMadrid;
    });

    const botCalls = todayCalls.filter((c: any) => c.call_type === 'bot').length;
    const humanCalls = todayCalls.filter((c: any) => c.call_type === 'human').length;

    const completedCalls = todayCalls.filter((c: any) => c.status === 'completed' && c.duration_seconds !== null);
    const avgDurationSeconds = completedCalls.length > 0
        ? Math.round(completedCalls.reduce((sum: number, c: any) => sum + parseInt(c.duration_seconds), 0) / completedCalls.length)
        : 0;

    // Cost metrics
    const todayCostEur = todayCalls.reduce((sum: number, c: any) => sum + (Number(c.cost_total_eur) || 0), 0);
    const thisMonthStart = new Date(); thisMonthStart.setDate(1); thisMonthStart.setHours(0, 0, 0, 0);
    const monthCalls = calls.filter((c: any) => c.started_at && new Date(c.started_at) >= thisMonthStart);
    const monthCostEur = monthCalls.reduce((sum: number, c: any) => sum + (Number(c.cost_total_eur) || 0), 0);
    const callsWithCost = calls.filter((c: any) => Number(c.cost_total_eur) > 0);
    const avgCostEur = callsWithCost.length > 0
        ? callsWithCost.reduce((sum: number, c: any) => sum + Number(c.cost_total_eur), 0) / callsWithCost.length
        : 0;
    const monthVapiMinutes = monthCalls.reduce((sum: number, c: any) => {
        const mins = (c.cost_breakdown as any)?.vapi?.minutes;
        return sum + (Number(mins) || 0);
    }, 0);

    if (isLoading && !config) {
        return (
            <DashboardLayout>
                <div className="flex h-[50vh] items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="space-y-6">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Asistente Telefónico</h2>
                    <p className="text-muted-foreground">
                        Gestiona las llamadas entrantes y audita las interacciones del asistente de Voz (IA).
                    </p>
                </div>

                <Tabs defaultValue="dashboard" className="w-full">
                    <TabsList className="w-full sm:w-auto bg-muted/80 p-1.5 h-auto gap-1">
                        <TabsTrigger
                            value="dashboard"
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all"
                        >
                            <BarChart3 className="h-4 w-4" />
                            Dashboard
                        </TabsTrigger>
                        <TabsTrigger
                            value="configuracion"
                            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md rounded-md transition-all"
                        >
                            <Settings className="h-4 w-4" />
                            Configuración
                        </TabsTrigger>
                    </TabsList>

                    {/* ═══════════ TAB: DASHBOARD ═══════════ */}
                    <TabsContent value="dashboard" className="space-y-6 mt-6">
                        {/* Stats cards */}
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Modo Actual</CardTitle>
                                    <Phone className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-center space-x-2 mt-2">
                                        <Switch
                                            id="mode-switch"
                                            checked={config?.mode === "bot"}
                                            onCheckedChange={handleModeChange}
                                            disabled={updateModeMutation.isPending}
                                        />
                                        <Label htmlFor="mode-switch" className="font-semibold text-lg">
                                            {config?.mode === "bot" ? "🤖 Bot IA" : "👤 Humano"}
                                        </Label>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-2">
                                        {config?.mode === "bot"
                                            ? "Las llamadas son atendidas por el asistente virtual."
                                            : "Las llamadas se desvían a tu número personal."}
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Llamadas Hoy</CardTitle>
                                    <PhoneCall className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{todayCalls.length}</div>
                                    <p className="text-xs text-muted-foreground">Total de llamadas recibidas hoy</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Atendidas por IA / Humano</CardTitle>
                                    <Bot className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{botCalls} / {humanCalls}</div>
                                    <p className="text-xs text-muted-foreground">Distribución de llamadas de hoy</p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Duración Media (IA)</CardTitle>
                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">
                                        {completedCalls.length ? formatDuration(avgDurationSeconds, "", "completed") : "—"}
                                    </div>
                                    <p className="text-xs text-muted-foreground">De las llamadas completadas por el bot hoy</p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Cost cards */}
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Gasto Hoy</CardTitle>
                                    <Euro className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">€{todayCostEur.toFixed(3)}</div>
                                    <p className="text-xs text-muted-foreground">Coste total de llamadas de hoy</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Gasto Este Mes</CardTitle>
                                    <Euro className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">€{monthCostEur.toFixed(2)}</div>
                                    <p className="text-xs text-muted-foreground">Acumulado mes actual</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Coste Medio</CardTitle>
                                    <Euro className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{callsWithCost.length > 0 ? `€${avgCostEur.toFixed(3)}` : '—'}</div>
                                    <p className="text-xs text-muted-foreground">Por llamada (con coste registrado)</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Min. IA Este Mes</CardTitle>
                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{monthVapiMinutes.toFixed(1)}</div>
                                    <p className="text-xs text-muted-foreground">Minutos facturados por VAPI</p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Call history */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Historial de Llamadas</CardTitle>
                                <CardDescription>
                                    Últimas 100 llamadas registradas en el sistema. Selecciona una para ver los detalles.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {calls.length === 0 ? (
                                    <div className="text-center py-6 text-muted-foreground">No hay llamadas registradas.</div>
                                ) : (
                                    <div className="rounded-md border">
                                        <div className="grid grid-cols-6 bg-muted/50 p-3 text-sm font-medium">
                                            <div>Fecha y Hora</div>
                                            <div>Número</div>
                                            <div>Tipo</div>
                                            <div>Estado</div>
                                            <div className="text-right">Duración</div>
                                            <div className="text-right">Coste</div>
                                        </div>
                                        <ScrollArea className="h-[400px]">
                                            {calls.map((call: any) => (
                                                <div
                                                    key={call.id}
                                                    className={`grid grid-cols-6 items-center border-t p-3 text-sm transition-colors hover:bg-muted/50 cursor-pointer ${call.call_type === 'bot' && call.tool_calls && call.tool_calls.length > 0 ? 'bg-primary/5' : ''}`}
                                                    onClick={() => setSelectedCall(call)}
                                                >
                                                    <div className="font-medium text-muted-foreground">
                                                        {format(new Date(call.started_at), "dd MMM, HH:mm", { locale: es })}
                                                    </div>
                                                    <div className="font-mono">{call.caller_number || "Oculto"}</div>
                                                    <div>
                                                        <div className="flex flex-col gap-1 items-start">
                                                            {call.call_type === "bot" ? (
                                                                <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100"><Bot className="w-3 h-3 mr-1" /> Bot</Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="text-slate-600"><User className="w-3 h-3 mr-1" /> Humano</Badge>
                                                            )}
                                                            {call.tool_calls && call.tool_calls.length > 0 && (
                                                                <div className="flex flex-wrap gap-1 mt-1">
                                                                    {call.tool_calls.some((t: any) => t.tool === 'create_reservation') && (
                                                                        <Badge variant="outline" className="text-[10px] px-1 h-4 bg-green-50 text-green-700 border-green-200">Reserva Nueva</Badge>
                                                                    )}
                                                                    {call.tool_calls.some((t: any) => t.tool === 'modify_reservation') && (
                                                                        <Badge variant="outline" className="text-[10px] px-1 h-4 bg-yellow-50 text-yellow-700 border-yellow-200">Modificación</Badge>
                                                                    )}
                                                                    {call.tool_calls.some((t: any) => t.tool === 'cancel_reservation') && (
                                                                        <Badge variant="outline" className="text-[10px] px-1 h-4 bg-red-50 text-red-700 border-red-200">Cancelación</Badge>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        {call.status === "completed" ? (
                                                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Completada</Badge>
                                                        ) : call.status === "active" ? (
                                                            <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 animate-pulse">En curso</Badge>
                                                        ) : (
                                                            <Badge variant="outline">{call.status}</Badge>
                                                        )}
                                                    </div>
                                                    <div className="text-right font-mono">
                                                        {formatDuration(call.duration_seconds, call.started_at, call.status)}
                                                    </div>
                                                    <div className="text-right font-mono text-muted-foreground">
                                                        {call.cost_total_eur != null
                                                            ? `€${Number(call.cost_total_eur).toFixed(3)}`
                                                            : '—'}
                                                    </div>
                                                </div>
                                            ))}
                                        </ScrollArea>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ═══════════ TAB: CONFIGURACIÓN ═══════════ */}
                    <TabsContent value="configuracion" className="space-y-6 mt-6">
                        {/* Horario programado */}
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <Calendar className="h-5 w-5" />
                                            Horario Programado
                                        </CardTitle>
                                        <CardDescription>
                                            Conmuta automáticamente entre bot y humano según el día y la hora.
                                            {scheduleEnabled && " (Activo — el toggle manual se ignora)"}
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={scheduleEnabled}
                                            onCheckedChange={handleScheduleToggle}
                                        />
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
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => addRange(dayIndex)}
                                                        disabled={!scheduleEnabled}
                                                        className="h-8 shadow-sm"
                                                    >
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
                                                        {rule.ranges.map((range: any) => (
                                                            <div key={range.id} className={`flex flex-col sm:flex-row gap-3 items-start sm:items-center p-2 rounded-md border ${range.mode === "bot" ? "bg-blue-50/50 border-blue-100" : "bg-green-50/50 border-green-100"}`}>
                                                                <Select
                                                                    value={range.mode}
                                                                    onValueChange={(v) => updateRangeRule(dayIndex, range.id, "mode", v)}
                                                                    disabled={!scheduleEnabled}
                                                                >
                                                                    <SelectTrigger className="w-full sm:w-[140px] h-9 bg-background">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="human">👤 Humano</SelectItem>
                                                                        <SelectItem value="bot">🤖 Bot IA</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                                                    <Input
                                                                        type="time"
                                                                        value={range.start}
                                                                        onChange={(e) => updateRangeRule(dayIndex, range.id, "start", e.target.value)}
                                                                        disabled={!scheduleEnabled}
                                                                        className="h-9 w-full sm:w-auto bg-background"
                                                                    />
                                                                    <span className="text-muted-foreground text-sm">a</span>
                                                                    <Input
                                                                        type="time"
                                                                        value={range.end}
                                                                        onChange={(e) => updateRangeRule(dayIndex, range.id, "end", e.target.value)}
                                                                        disabled={!scheduleEnabled}
                                                                        className="h-9 w-full sm:w-auto bg-background"
                                                                    />
                                                                </div>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="text-destructive h-9 w-9 sm:ml-auto hover:bg-destructive/10"
                                                                    onClick={() => removeRange(dayIndex, range.id)}
                                                                    disabled={!scheduleEnabled}
                                                                >
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
                                    <Button
                                        className="mt-6 w-full shadow-sm"
                                        onClick={saveSchedule}
                                        disabled={updateScheduleMutation.isPending}
                                    >
                                        {updateScheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                        Guardar horarios
                                    </Button>
                                )}
                            </CardContent>
                        </Card>

                        {/* VAPI Simulator + Prompt Editor */}
                        <div className="grid gap-6 md:grid-cols-2">
                            <VapiCallSimulator assistantId={config?.vapi_assistant_id} />
                            <VapiPromptEditor config={config} />
                        </div>

                        {/* Editor de respuestas del bot */}
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="flex items-center gap-2">
                                            <MessageSquare className="h-5 w-5" />
                                            Respuestas del Bot
                                        </CardTitle>
                                        <CardDescription>
                                            Personaliza los textos que dice el asistente en cada situación. Usa {"{ variable }"} como placeholder. Si dejas un campo vacío, se usará el texto por defecto.
                                        </CardDescription>
                                    </div>
                                    {botResponsesDirty && (
                                        <Button
                                            onClick={() => updateBotResponsesMutation.mutate(botResponses)}
                                            disabled={updateBotResponsesMutation.isPending}
                                            className="shrink-0"
                                        >
                                            {updateBotResponsesMutation.isPending
                                                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                : <Save className="h-4 w-4 mr-2" />}
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
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-7 text-xs shrink-0 text-muted-foreground hover:text-foreground"
                                                                    onClick={() => {
                                                                        const newBR = { ...botResponses };
                                                                        delete newBR[key];
                                                                        setBotResponses(newBR);
                                                                        setBotResponsesDirty(true);
                                                                    }}
                                                                >
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

                {/* Modal de Detalle de Llamada */}
                <Dialog open={!!selectedCall} onOpenChange={(open) => !open && setSelectedCall(null)}>
                    <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                Detalle de Llamada
                                {selectedCall?.call_type === "bot" ? (
                                    <Badge variant="secondary" className="bg-blue-100 text-blue-800"><Bot className="w-3 h-3 mr-1" /> Bot</Badge>
                                ) : (
                                    <Badge variant="outline"><User className="w-3 h-3 mr-1" /> Humano</Badge>
                                )}
                            </DialogTitle>
                            <DialogDescription>
                                Número: <span className="font-mono font-medium text-foreground">{selectedCall?.caller_number || "Oculto"}</span> •
                                Fecha: {selectedCall && format(new Date(selectedCall.started_at), "dd/MM/yyyy HH:mm")} •
                                Duración: {selectedCall && formatDuration(selectedCall.duration_seconds, selectedCall.started_at, selectedCall.status)}
                            </DialogDescription>
                        </DialogHeader>

                        <ScrollArea className="flex-1 mt-4 p-4 border rounded-md space-y-4">
                            {selectedCall?.call_type === "bot" && (selectedCall?.cost_total_eur != null || selectedCall?.ended_reason) && (
                                <div className="mb-6 space-y-3">
                                    <h4 className="font-semibold flex items-center gap-2 text-primary">
                                        <Euro className="w-4 h-4" />
                                        Coste de la llamada
                                    </h4>
                                    <div className="flex flex-wrap gap-3 items-center">
                                        {selectedCall?.cost_total_eur != null && (
                                            <span className="text-lg font-bold">
                                                €{Number(selectedCall.cost_total_eur).toFixed(4)}
                                            </span>
                                        )}
                                        {selectedCall?.ended_reason && (() => {
                                            const r = ENDED_REASON_LABELS[selectedCall.ended_reason];
                                            return (
                                                <Badge className={`${r?.color || 'bg-gray-100 text-gray-700'} border-0 font-normal`}>
                                                    {r?.label || selectedCall.ended_reason}
                                                </Badge>
                                            );
                                        })()}
                                    </div>
                                    {selectedCall?.cost_breakdown && Object.keys(selectedCall.cost_breakdown).length > 0 && (
                                        <div className="rounded-md border overflow-hidden text-sm">
                                            <div className="grid grid-cols-2 bg-muted/50 px-3 py-2 font-medium text-xs">
                                                <div>Componente</div>
                                                <div className="text-right">Coste</div>
                                            </div>
                                            {Object.entries(selectedCall.cost_breakdown as Record<string, any>).map(([key, val]) => (
                                                <div key={key} className="grid grid-cols-2 px-3 py-1.5 border-t text-xs">
                                                    <div className="text-muted-foreground">{COST_COMPONENT_LABELS[key] || key}</div>
                                                    <div className="text-right font-mono">
                                                        €{Number(val.cost_eur || 0).toFixed(4)}
                                                        {val.promptTokens && <span className="text-muted-foreground ml-1">({val.promptTokens}+{val.completionTokens} tok)</span>}
                                                        {val.minutes && <span className="text-muted-foreground ml-1">({Number(val.minutes).toFixed(2)} min)</span>}
                                                        {val.characters && <span className="text-muted-foreground ml-1">({val.characters} chars)</span>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {selectedCall?.call_type === "human" ? (
                                <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground space-y-3">
                                    <User className="w-12 h-12 text-slate-200" />
                                    <p>Llamada transferida directamente al teléfono físico gestionado por un humano.</p>
                                    <p className="text-sm">El asistente de IA no procesó ninguna intención en esta llamada.</p>
                                </div>
                            ) : selectedCall?.summary ? (
                                <div className="mb-6 space-y-2">
                                    <h4 className="font-semibold flex items-center gap-2 text-primary">
                                        <Info className="w-4 h-4" />
                                        Resumen generado por la IA
                                    </h4>
                                    <p className="text-sm bg-muted p-3 rounded-md">{selectedCall.summary}</p>
                                </div>
                            ) : null}

                            {selectedCall?.call_type === "bot" && (
                                <div>
                                    <h4 className="font-semibold flex items-center gap-2 mb-4">
                                        <ListFilter className="w-4 h-4" />
                                        Registro de Herramientas Usadas
                                    </h4>

                                    {(!selectedCall.tool_calls || selectedCall.tool_calls.length === 0) ? (
                                        <p className="text-sm text-muted-foreground italic">El asistente no utilizó ninguna herramienta en esta llamada.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            {selectedCall.tool_calls.map((tool: any, idx: number) => (
                                                <div key={idx} className="border rounded-md overflow-hidden text-sm">
                                                    <div className="bg-muted px-3 py-2 border-b flex justify-between items-center">
                                                        <span className="font-mono font-medium text-primary">{tool.tool}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {tool.timestamp ? format(new Date(tool.timestamp), "HH:mm:ss") : ""}
                                                        </span>
                                                    </div>
                                                    <div className="p-3 border-b border-dashed border-border/50 bg-slate-50">
                                                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Parámetros enviados (IA → Sistema)</span>
                                                        {Object.keys(tool.params || {}).length > 0 ? (
                                                            <pre className="text-xs bg-white p-2 text-slate-800 rounded border font-mono overflow-x-auto">
                                                                {JSON.stringify(tool.params, null, 2)}
                                                            </pre>
                                                        ) : (
                                                            <span className="text-xs text-slate-400 italic">Ningún parámetro</span>
                                                        )}
                                                    </div>
                                                    <div className="p-3 bg-white">
                                                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Resultado (Sistema → IA)</span>
                                                        {tool.result ? (
                                                            <div className="text-xs p-2 bg-green-50 text-green-900 rounded border border-green-100 max-h-40 overflow-y-auto">
                                                                {typeof tool.result === 'string'
                                                                    ? tool.result
                                                                    : <pre className="font-mono">{JSON.stringify(tool.result, null, 2)}</pre>}
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-slate-400 italic">Sin resultado</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </ScrollArea>
                    </DialogContent>
                </Dialog>

            </div>
        </DashboardLayout>
    );
}
