// Cliente Supabase para la base de datos de métricas, incidencias e instalaciones
import { createClient } from '@supabase/supabase-js';
import type { MetricsDatabase } from './metricsTypes';

const SUPABASE_METRICS_URL = import.meta.env.VITE_SUPABASE_METRICS_URL;
const SUPABASE_METRICS_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_METRICS_PUBLISHABLE_KEY;

if (!SUPABASE_METRICS_URL || !SUPABASE_METRICS_PUBLISHABLE_KEY) {
  throw new Error(
    "Faltan las variables de entorno de Supabase Metrics. Asegúrate de definir VITE_SUPABASE_METRICS_URL y VITE_SUPABASE_METRICS_PUBLISHABLE_KEY en tu archivo .env",
  );
}

// Import the metrics supabase client like this:
// import { metricsClient } from "@/integrations/supabase/metricsClient";

export const metricsClient = createClient<MetricsDatabase>(
  SUPABASE_METRICS_URL,
  SUPABASE_METRICS_PUBLISHABLE_KEY,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);
