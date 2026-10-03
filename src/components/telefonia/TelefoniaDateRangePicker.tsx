import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange, PresetRange } from "./types";

interface Props {
    value: DateRange;
    preset?: PresetRange;
    onChange: (range: DateRange, preset: PresetRange) => void;
}

function startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function endOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
}

function presetRange(preset: PresetRange): DateRange {
    const today = new Date();
    const to = endOfDay(today);
    if (preset === "today") return { dateFrom: startOfDay(today), dateTo: to };
    const daysMap: Record<Exclude<PresetRange, "today" | "custom">, number> = {
        "7d": 7,
        "30d": 30,
        "90d": 90,
    };
    const days = daysMap[preset as "7d" | "30d" | "90d"] ?? 7;
    const from = startOfDay(new Date(today.getTime() - (days - 1) * 86400000));
    return { dateFrom: from, dateTo: to };
}

export function TelefoniaDateRangePicker({ value, preset = "7d", onChange }: Props) {
    const [customOpen, setCustomOpen] = useState(false);

    const presets: { key: PresetRange; label: string }[] = [
        { key: "today", label: "Hoy" },
        { key: "7d", label: "7d" },
        { key: "30d", label: "30d" },
        { key: "90d", label: "90d" },
    ];

    return (
        <div className="flex items-center gap-1 flex-wrap">
            <div className="inline-flex rounded-md border bg-card p-0.5">
                {presets.map((p) => (
                    <Button
                        key={p.key}
                        variant={preset === p.key ? "default" : "ghost"}
                        size="sm"
                        className="h-11 px-4 text-sm"
                        onClick={() => onChange(presetRange(p.key), p.key)}
                    >
                        {p.label}
                    </Button>
                ))}
            </div>

            <Popover open={customOpen} onOpenChange={setCustomOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant={preset === "custom" ? "default" : "outline"}
                        size="sm"
                        className={cn("h-11 gap-2 px-4 text-sm")}
                    >
                        <CalendarIcon className="h-4 w-4" />
                        {preset === "custom"
                            ? `${format(value.dateFrom, "d MMM", { locale: es })} – ${format(value.dateTo, "d MMM", { locale: es })}`
                            : "Rango"}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto max-w-[calc(100vw-1.5rem)] overflow-x-auto p-0" align="end" collisionPadding={12}>
                    <Calendar
                        mode="range"
                        locale={es}
                        numberOfMonths={2}
                        defaultMonth={value.dateFrom}
                        selected={{ from: value.dateFrom, to: value.dateTo }}
                        onSelect={(r: any) => {
                            if (r?.from && r?.to) {
                                onChange(
                                    {
                                        dateFrom: startOfDay(r.from),
                                        dateTo: endOfDay(r.to),
                                    },
                                    "custom",
                                );
                                setCustomOpen(false);
                            }
                        }}
                    />
                </PopoverContent>
            </Popover>
        </div>
    );
}

export default TelefoniaDateRangePicker;
