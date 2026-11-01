import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { calcularVersion } from "./scripts/version.mjs";

// Identificador del build: versiona la caché del service worker (public/sw.js)
// para que cada despliegue tire la caché anterior. En Vercel es el commit.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString(36)).slice(0, 12);

// Versión M.N que se ve en el pie del menú (docs/PROCESO-DE-CAMBIOS.md).
const VERSION_APP = calcularVersion();

// Publica dist/version.json con el id del build: el panel lo consulta (sin
// caché) para avisar de versión nueva (src/actualizacion/AvisoActualizacion.tsx).
function versionJson(): Plugin {
  return {
    name: "version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: BUILD_ID, ...VERSION_APP }) });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  if (command === "build") {
    console.log(`Versión ${VERSION_APP.version} · ${VERSION_APP.entorno} · ${VERSION_APP.commit ?? "sin commit"}${VERSION_APP.aviso ? ` · AVISO: ${VERSION_APP.aviso}` : ""}`);
  }
  return {
  server: {
    host: "::",
    port: 8080,
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __VERSION_APP__: JSON.stringify(VERSION_APP),
  },
  plugins: [react(), versionJson()],
  // Worker del recorte de fotos de vino (onnxruntime-web): módulo ES, y sin
  // pre-empaquetar en dev para que encuentre su .wasm.
  worker: { format: "es" as const },
  build: {
    rollupOptions: {
      output: {
        // Librerías que usa todo el panel en ficheros propios (01-11-2026): no
        // cambian entre despliegues, así que el navegador las conserva y solo
        // vuelve a bajar el código del panel que sí ha cambiado. Lo que solo
        // usa una pantalla (gráficas, editor de planos, llamadas de voz, PDF…)
        // se queda con su página, que ya se carga bajo demanda (App.tsx).
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return "vendor-react";
          if (id.includes("/node_modules/@supabase/")) return "vendor-supabase";
          if (id.includes("/node_modules/@radix-ui/")) return "vendor-radix";
          if (id.includes("/node_modules/@tanstack/")) return "vendor-query";
          return undefined;
        },
      },
    },
  },
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
};
});
