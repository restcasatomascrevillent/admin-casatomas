import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // `src/integrations/supabase/client.ts` lanza si faltan estas variables, y
    // 16 ficheros de test lo importan (directa o indirectamente) aunque luego
    // lo simulen. Sin `.env` la suite fallaba al cargar. Valores ficticios a
    // propósito: un host local que nunca responde, para que ningún test pueda
    // hablar con el Supabase de producción aunque exista un `.env` real.
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY: "clave-anon-de-pruebas",
      VITE_SUPABASE_PUBLISHABLE_KEY: "clave-anon-de-pruebas",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/hooks/**", "src/schemas/**", "src/config/**", "src/components/**"],
      exclude: ["src/integrations/**", "src/test/**", "**/__tests__/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
