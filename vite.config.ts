import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { calcularVersion } from "./scripts/version.mjs";
import { FICHEROS_FFMPEG, RUTA_FFMPEG, VERSION_FFMPEG_CORE } from "./src/components/carta/video/rutaFfmpeg";

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

// Núcleo de ffmpeg.wasm (conversión de .mov HEVC del móvil, ~32 MB): se sirve
// desde el propio panel en RUTA_FFMPEG (la CSP solo deja 'self'), copiado de
// node_modules en el build y servido desde ahí en dev. No se sube al repo.
function ffmpegCore(): Plugin {
  const dir = path.resolve(__dirname, "node_modules/@ffmpeg/core/dist/esm");
  const comprobarVersion = () => {
    const v = JSON.parse(fs.readFileSync(path.resolve(__dirname, "node_modules/@ffmpeg/core/package.json"), "utf8")).version;
    if (v !== VERSION_FFMPEG_CORE) throw new Error(`@ffmpeg/core es ${v} y rutaFfmpeg.ts dice ${VERSION_FFMPEG_CORE}: actualiza VERSION_FFMPEG_CORE`);
  };
  return {
    name: "ffmpeg-core",
    configureServer(server) {
      server.middlewares.use(RUTA_FFMPEG, (req, res, next) => {
        const nombre = (req.url ?? "").split("?")[0].replace(/^\//, "");
        if (!(FICHEROS_FFMPEG as readonly string[]).includes(nombre)) return next();
        res.setHeader("Content-Type", nombre.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        fs.createReadStream(path.join(dir, nombre)).pipe(res);
      });
    },
    generateBundle() {
      comprobarVersion();
      for (const nombre of FICHEROS_FFMPEG) {
        this.emitFile({ type: "asset", fileName: `${RUTA_FFMPEG.slice(1)}/${nombre}`, source: fs.readFileSync(path.join(dir, nombre)) });
      }
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
  plugins: [react(), versionJson(), ffmpegCore()],
  // Worker del recorte de fotos de vino (onnxruntime-web): módulo ES, y sin
  // pre-empaquetar en dev para que encuentre su .wasm.
  worker: { format: "es" as const },
  build: {
    rollupOptions: {
      // Segunda entrada: la página de captura de reels que abre el trabajador
      // de render (docs/instagram-video.md). No carga nada del panel.
      input: {
        main: path.resolve(__dirname, "index.html"),
        "reel-instagram": path.resolve(__dirname, "__reel-instagram.html"),
      },
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
  // @ffmpeg/ffmpeg crea su worker con new URL(..., import.meta.url): sin pre-empaquetar.
  optimizeDeps: { exclude: ["onnxruntime-web", "@ffmpeg/ffmpeg"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
};
});
