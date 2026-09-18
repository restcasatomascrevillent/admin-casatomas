import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
    CartesianGrid,
} from "recharts";
import type { CallLogsAnalytics } from "./types";

interface Props {
    data?: CallLogsAnalytics["byIntent"];
    isLoading?: boolean;
}

const INTENT_LABELS: Record<string, string> = {
    crear: "Crear reserva",
    modificar: "Modificar",
    cancelar: "Cancelar",
    info: "Información",
    hablar_humano: "Hablar humano",
    buscar: "Buscar",
    disponibilidad: "Disponibilidad",
    otro: "Otro",
};

const INTENT_COLORS: Record<string, string> = {
    crear: "hsl(142 71% 45%)", // verde
    modificar: "hsl(38 92% 50%)", // ámbar
    cancelar: "hsl(0 84% 60%)", // rojo
    info: "hsl(199 89% 48%)", // azul
    hablar_humano: "hsl(262 83% 58%)", // púrpura
    buscar: "hsl(173 58% 39%)", // teal
    disponibilidad: "hsl(221 83% 53%)", // índigo
    otro: "hsl(215 20% 65%)", // gris
};

function colorFor(intent: string) {
    return INTENT_COLORS[intent] || "hsl(215 20% 65%)";
}

function labelFor(intent: string) {
    return INTENT_LABELS[intent] || intent;
}

export function TelefoniaIntentChart({ data, isLoading }: Props) {
    const chartData = (data || []).map((d) => ({
        name: labelFor(d.intent),
        rawIntent: d.intent,
        count: d.count,
    }));

    const hasData = chartData.some((d) => d.count > 0);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Intenciones detectadas</CardTitle>
                <CardDescription>Distribución de qué pide la gente al bot</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Skeleton className="h-[260px] w-full" />
                ) : !hasData ? (
                    <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                        No hay llamadas en este periodo.
                    </div>
                ) : (
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" vertical={false} />
                                <XAxis
                                    dataKey="name"
                                    tickLine={false}
                                    axisLine={false}
                                    className="text-xs"
                                    interval={0}
                                    angle={-20}
                                    textAnchor="end"
                                    height={60}
                                />
                                <YAxis
                                    tickLine={false}
                                    axisLine={false}
                                    allowDecimals={false}
                                    className="text-xs"
                                />
                                <Tooltip
                                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                                    contentStyle={{
                                        background: "hsl(var(--popover))",
                                        border: "1px solid hsl(var(--border))",
                                        borderRadius: 8,
                                        fontSize: 12,
                                        color: "hsl(var(--popover-foreground))",
                                    }}
                                />
                                <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Llamadas">
                                    {chartData.map((entry) => (
                                        <Cell key={entry.rawIntent} fill={colorFor(entry.rawIntent)} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default TelefoniaIntentChart;
