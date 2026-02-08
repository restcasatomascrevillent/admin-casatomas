import { z } from "zod";

// =====================================================
// SCHEMAS DE VALIDACIÓN PARA FORMULARIOS DE CARTA
// =====================================================

// Helper para validar URLs
const urlSchema = z.string().url("Debe ser una URL válida").optional().or(z.literal(""));

// =====================================================
// 1. SCHEMA PARA PLATOS
// =====================================================

export const platoSchema = z.object({
    nombre: z
        .string()
        .min(1, "El nombre es requerido")
        .max(200, "El nombre no puede exceder 200 caracteres"),

    categoria: z
        .string()
        .min(1, "La categoría es requerida"),

    precio_eur: z
        .number({
            required_error: "El precio es requerido",
            invalid_type_error: "El precio debe ser un número",
        })
        .positive("El precio debe ser mayor a 0")
        .max(9999, "El precio no puede exceder 9999€"),

    descripcion: z
        .string()
        .max(1000, "La descripción no puede exceder 1000 caracteres")
        .optional(),

    unidad: z
        .string()
        .max(50, "La unidad no puede exceder 50 caracteres")
        .optional(),

    alergenos_oficiales: z
        .array(z.string())
        .optional()
        .default([]),

    alergenos_notas: z
        .string()
        .max(500, "Las notas de alérgenos no pueden exceder 500 caracteres")
        .optional(),

    imagen_url: urlSchema,

    orden: z
        .number()
        .int("El orden debe ser un número entero")
        .nonnegative("El orden no puede ser negativo")
        .optional(),
});

export type PlatoFormData = z.infer<typeof platoSchema>;

// =====================================================
// 2. SCHEMA PARA BEBIDAS
// =====================================================

export const bebidaSchema = z.object({
    nombre: z
        .string()
        .min(1, "El nombre es requerido")
        .max(200, "El nombre no puede exceder 200 caracteres"),

    categoria: z
        .string()
        .min(1, "La categoría es requerida"),

    precio_eur: z
        .number({
            required_error: "El precio es requerido",
            invalid_type_error: "El precio debe ser un número",
        })
        .positive("El precio debe ser mayor a 0")
        .max(9999, "El precio no puede exceder 9999€"),

    tamano: z
        .string()
        .max(50, "El tamaño no puede exceder 50 caracteres")
        .optional(),

    descripcion: z
        .string()
        .max(1000, "La descripción no puede exceder 1000 caracteres")
        .optional(),

    imagen_url: urlSchema,

    orden: z
        .number()
        .int("El orden debe ser un número entero")
        .nonnegative("El orden no puede ser negativo")
        .optional(),
});

export type BebidaFormData = z.infer<typeof bebidaSchema>;

// =====================================================
// 3. SCHEMA PARA VINOS
// =====================================================

export const vinoSchema = z.object({
    nombre: z
        .string()
        .min(1, "El nombre es requerido")
        .max(200, "El nombre no puede exceder 200 caracteres"),

    categoria: z
        .string()
        .min(1, "La categoría es requerida"),

    precio_eur: z
        .number({
            required_error: "El precio es requerido",
            invalid_type_error: "El precio debe ser un número",
        })
        .positive("El precio debe ser mayor a 0")
        .max(9999, "El precio no puede exceder 9999€"),

    denominacion_origen: z
        .string()
        .max(200, "La denominación de origen no puede exceder 200 caracteres")
        .optional(),

    ubicacion_pais: z
        .string()
        .max(100, "El país no puede exceder 100 caracteres")
        .optional(),

    ubicacion_region: z
        .string()
        .max(200, "La región no puede exceder 200 caracteres")
        .optional(),

    descripcion: z
        .string()
        .max(1000, "La descripción no puede exceder 1000 caracteres")
        .optional(),

    alergenos_oficiales: z
        .array(z.string())
        .optional()
        .default([]),

    alergenos_notas: z
        .string()
        .max(500, "Las notas de alérgenos no pueden exceder 500 caracteres")
        .optional(),

    imagen_url: urlSchema,

    orden: z
        .number()
        .int("El orden debe ser un número entero")
        .nonnegative("El orden no puede ser negativo")
        .optional(),
});

export type VinoFormData = z.infer<typeof vinoSchema>;

// =====================================================
// 4. SCHEMA PARA CÓCTELES
// =====================================================

export const coctelSchema = z.object({
    nombre: z
        .string()
        .min(1, "El nombre es requerido")
        .max(200, "El nombre no puede exceder 200 caracteres"),

    categoria: z
        .string()
        .min(1, "La categoría es requerida")
        .refine(
            (val) => ["autor", "clasicos", "sin-alcohol"].includes(val),
            "La categoría debe ser: autor, clasicos o sin-alcohol"
        ),

    precio_eur: z
        .number({
            required_error: "El precio es requerido",
            invalid_type_error: "El precio debe ser un número",
        })
        .positive("El precio debe ser mayor a 0")
        .max(9999, "El precio no puede exceder 9999€"),

    base: z
        .string()
        .min(1, "La base es requerida")
        .refine(
            (val) => ["ginebra", "vodka", "ron", "tequila", "aperol", "sin-alcohol", "all"].includes(val),
            "La base debe ser una de las opciones válidas"
        ),

    descripcion: z
        .string()
        .max(1000, "La descripción no puede exceder 1000 caracteres")
        .optional(),

    ingredientes: z
        .string()
        .min(1, "Los ingredientes son requeridos")
        .max(500, "Los ingredientes no pueden exceder 500 caracteres")
        .refine(
            (val) => val.includes(",") || val.split(" ").length >= 1,
            "Los ingredientes deben estar separados por comas"
        ),

    imagen_url: urlSchema,

    orden: z
        .number()
        .int("El orden debe ser un número entero")
        .nonnegative("El orden no puede ser negativo")
        .optional(),
});

export type CoctelFormData = z.infer<typeof coctelSchema>;

// =====================================================
// FUNCIONES HELPER PARA VALIDACIÓN
// =====================================================

/**
 * Valida un formulario y retorna los errores formateados
 */
export function validateForm<T>(
    schema: z.ZodSchema<T>,
    data: unknown
): { success: true; data: T } | { success: false; errors: Record<string, string> } {
    const result = schema.safeParse(data);

    if (result.success) {
        return { success: true, data: result.data };
    }

    const errors: Record<string, string> = {};
    result.error.errors.forEach((error) => {
        const path = error.path.join(".");
        errors[path] = error.message;
    });

    return { success: false, errors };
}

/**
 * Valida un campo individual
 */
export function validateField<T>(
    schema: z.ZodSchema<T>,
    fieldName: string,
    value: unknown
): string | null {
    try {
        const fieldSchema = (schema as any).shape[fieldName];
        if (!fieldSchema) return null;

        fieldSchema.parse(value);
        return null;
    } catch (error) {
        if (error instanceof z.ZodError) {
            return error.errors[0]?.message || "Error de validación";
        }
        return "Error de validación";
    }
}
