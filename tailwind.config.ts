import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  // Con `hoverOnlyWhenSupported` todo `hover:` / `group-hover:` va envuelto en
  // `@media (hover: hover)`: en una tablet táctil un toque ya no deja el
  // estado :hover "pegado" (un botón se queda resaltado hasta tocar otro sitio).
  // OJO: lo que solo aparece con hover (`opacity-0 group-hover:opacity-100`) NO
  // se activaría nunca en táctil; index.css lo fuerza visible con
  // `@media (hover: none)`. Aun así, preferible no esconder acciones tras hover.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    screens: {
      xs: "475px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // Dorado de marca (Fase 3, 11/11/2026): sustituye los `hsl(38,59%,45%)` escritos a mano.
        gold: {
          DEFAULT: "hsl(var(--gold))",
          strong: "hsl(var(--gold-strong))",
          deep: "hsl(var(--gold-deep))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        status: {
          pending: "hsl(var(--status-pending))",
          "pending-foreground": "hsl(var(--status-pending-foreground))",
          verified: "hsl(var(--status-verified))",
          "verified-foreground": "hsl(var(--status-verified-foreground))",
          confirmed: "hsl(var(--status-confirmed))",
          "confirmed-foreground": "hsl(var(--status-confirmed-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        // Brillo que cruza una miniatura mientras la IA trabaja (asistente móvil de Instagram).
        brillo: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        brillo: "brillo 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // Variantes para diseñar PARA TABLET TÁCTIL sin tocar el aspecto de escritorio
    // (convención del panel, 03/10/2026):
    //   pointer-coarse:  dedo (iPad/Android). Ej.: `pointer-coarse:h-11` = 44 px solo en táctil.
    //   pointer-fine:    ratón / trackpad principal.
    //   no-hover:        sin hover real (dedo). Ej.: `no-hover:opacity-100`.
    plugin(({ addVariant }) => {
      addVariant("pointer-coarse", "@media (pointer: coarse)");
      addVariant("pointer-fine", "@media (pointer: fine)");
      // Complemento exacto de la condición con la que `hoverOnlyWhenSupported` activa `hover:`.
      addVariant("no-hover", "@media (hover: none), (pointer: coarse)");
    }),
    // CONTAINER QUERIES (Facturas › Análisis, 06/11/2026), la misma sintaxis que
    // el plugin oficial `@tailwindcss/container-queries` (sin añadir dependencia):
    //   `@container` / `@container/tablero` → `container-type: inline-size` (y nombre);
    //   `@md:` · `@[30rem]:` · `@[30rem]/tablero:` → `@container [nombre] (min-width: …)`.
    // Sirven para que una tarjeta se ordene según el sitio que TIENE (el tablero
    // se estrecha al abrir la IA), no según el ancho de la pantalla.
    plugin(
      ({ matchUtilities, matchVariant, theme }) => {
        matchUtilities(
          { "@container": (value, { modifier }) => ({ "container-type": value, ...(modifier ? { "container-name": modifier } : {}) }) },
          { values: { DEFAULT: "inline-size", normal: "normal" }, modifiers: "any" },
        );
        const ancho = (v: string) => {
          const n = /^(\d+\.\d+|\d+|\.\d+)\D+/.exec(v)?.[1];
          return n === undefined ? null : parseFloat(v);
        };
        matchVariant(
          "@",
          (value = "", { modifier }) => (ancho(value) !== null ? `@container ${modifier ?? ""} (min-width: ${value})` : []),
          {
            values: theme("containers") ?? {},
            sort(a, z) {
              const d = parseFloat(a.value) - parseFloat(z.value);
              if (d !== 0) return d;
              const ma = a.modifier ?? "";
              const mz = z.modifier ?? "";
              if (ma === "" && mz !== "") return 1;
              if (ma !== "" && mz === "") return -1;
              return ma.localeCompare(mz, "en", { numeric: true });
            },
          },
        );
      },
      {
        theme: {
          containers: {
            xs: "20rem",
            sm: "24rem",
            md: "28rem",
            lg: "32rem",
            xl: "36rem",
            "2xl": "42rem",
            "3xl": "48rem",
            "4xl": "56rem",
            "5xl": "64rem",
            "6xl": "72rem",
            "7xl": "80rem",
          },
        },
      },
    ),
  ],
} satisfies Config;
