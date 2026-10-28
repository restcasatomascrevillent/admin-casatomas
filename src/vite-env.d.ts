/// <reference types="vite/client" />

/** Identificador del build (ver vite.config.ts); versiona la caché del SW. */
declare const __BUILD_ID__: string;

/** Versión del build (scripts/version.mjs, ver vite.config.ts); usar `VERSION_APP` de src/lib/version.ts. */
declare const __VERSION_APP__: import("./lib/version").VersionApp;
