import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ComposedChart,
    Area,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    Legend,
} from "recharts";
import type { CallLogsAnalytics } from "./types";

interface Props {
    data?: CallLogsAnalytics["callsPerDay"];
    isLoading?: boolean;
}

function formatDate(d: string) {
    try {
        return new Intl.DateTimeFormat("es-ES", {
            day: "2-digit",
            month: "short",
        }).format(new Date(d));
    } catch {
        return d;
    }
}

export function TelefoniaCallsTimeline({ data, isLoading }: Props) {
    const chartData = (data || []).map((d) => ({
        date: d.date,
        dateLabel: formatDate(d.date),
        count: d.count,
        avgDuration: Math.round(((d.avgDuration || 0) / 60) * 10) / 10, // segs → minutos (1 decimal)
    }));

    const hasData = chartData.some((d) => d.count > 0);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Evolución temporal</CardTitle>
                <CardDescription>Llamadas por día y duración media (min)</CardDescription>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <Skeleton className="h-[300px] w-full" />
                ) : !hasData ? (
                    <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">
                        No hay llamadas en este periodo.
                    </div>
                ) : (
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart
                                data={chartData}
                                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                            >
                                <defs>
                                    <linearGradient id="fillCalls" x1="0" y1="0" x2="0" y2="1">
                                        <stop
                                            offset="5%"
                                            stopColor="hsl(199 89% 48%)"
                                            stopOpacity={0.6}
                                        />
                                        <stop
                                            offset="95%"
                                            stopColor="hsl(199 89% 48%)"
                                            stopOpacity={0.05}
                                        />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    className="stroke-border/50"
                                    vertical={false}
                                />
                                <XAxis
                                    dataKey="dateLabel"
                                    tickLine={false}
                                    axisLine={false}
                                    className="text-xs"
                                />
                                <YAxis
                                    yAxisId="left"
                                    tickLine={false}
                                    axisLine={false}
                                    allowDecimals={false}
                                    className="text-xs"
                                />
                                <YAxis
                                    yAxisId="right"
                                    orientation="right"
                                    tickLine={false}
                                    axisLine={false}
                                    className="text-xs"
                                />
                                <Tooltip
                                    cursor={{ stroke: "hsl(var(--border))" }}
                                    contentStyle={{
                                        background: "hsl(var(--popover))",
                                        border: "1px solid hsl(var(--border))",
                                        borderRadius: 8,
                                        fontSize: 12,
                                        color: "hsl(var(--popover-foreground))",
                                    }}
                                />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Area
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="count"
                                    stroke="hsl(199 89% 48%)"
                                    fill="url(#fillCalls)"
                                    name="Llamadas"
                                    strokeWidth={2}
                                />
                                <Line
                                    yAxisId="right"
                                    type="monotone"
                                    dataKey="avgDuration"
                                    stroke="hsl(38 92% 50%)"
                                    name="Duración media (min)"
                                    strokeWidth={2}
                                    dot={{ r: 3 }}
                                />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default TelefoniaCallsTimeline;
