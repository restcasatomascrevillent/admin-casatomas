import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CallLogStructuredData {
  intent?: string | null;
  reserva_creada?: boolean | string | null;
  motivo_fallo?: string | null;
  sentiment?: string | null;
  numero_comensales?: number | null;
  fecha_solicitada?: string | null;
  nombre_cliente?: string | null;
  transferido_a_humano?: boolean | string | null;
  [key: string]: unknown;
}

export interface CallLogRow {
  id: string;
  vapi_call_id: string | null;
  caller_number: string | null;
  call_type: string | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  ended_reason: string | null;
  cost_total_usd: number | null;
  cost_total_eur: number | null;
  success_evaluation: string | null;
  structured_data: CallLogStructuredData | null;
}

export interface UseCallLogsFilters {
  dateFrom?: string;
  dateTo?: string;
  intent?: string;
  success?: "Pass" | "Fail";
  sentiment?: string;
  callType?: "bot" | "human";
  limit?: number;
}

const CALL_LOGS_COLUMNS =
  "id,vapi_call_id,caller_number,call_type,status,started_at,ended_at,duration_seconds,summary,ended_reason,cost_total_usd,cost_total_eur,success_evaluation,structured_data";

export function useCallLogs(filters: UseCallLogsFilters = {}) {
  const queryClient = useQueryClient();
  const {
    dateFrom,
    dateTo,
    intent,
    success,
    sentiment,
    callType,
    limit = 100,
  } = filters;

  const query = useQuery<CallLogRow[]>({
    queryKey: [
      "call_logs",
      { dateFrom, dateTo, intent, success, sentiment, callType, limit },
    ],
    queryFn: async () => {
      let q = supabase
        .from("call_logs")
        .select(CALL_LOGS_COLUMNS)
        .order("started_at", { ascending: false })
        .limit(limit);

      if (dateFrom) q = q.gte("started_at", dateFrom);
      if (dateTo) q = q.lte("started_at", dateTo);
      if (callType) q = q.eq("call_type", callType);
      if (success) q = q.eq("success_evaluation", success);
      if (intent) q = q.eq("structured_data->>intent", intent);
      if (sentiment) q = q.eq("structured_data->>sentiment", sentiment);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as CallLogRow[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("call_logs_realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "call_logs" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["call_logs"] });
          queryClient.invalidateQueries({ queryKey: ["call_logs_analytics"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "call_logs" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["call_logs"] });
          queryClient.invalidateQueries({ queryKey: ["call_logs_analytics"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
