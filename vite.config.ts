import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Identificador del build: versiona la caché del service worker (public/sw.js)
// para que cada despliegue tire la caché anterior. En Vercel es el commit.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString(36)).slice(0, 12);

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
