// Tipos TypeScript para la base de datos de métricas, incidencias e instalaciones

export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

// Tabla de Métricas
export interface Metrica {
    id: string;
    tipo: string; // Tipo de métrica: 'visitas', 'ventas', 'rendimiento', etc.
    valor: number;
    unidad?: string; // Unidad de medida: 'euros', 'unidades', 'ms', etc.
    fecha: string;
    usuario_id?: string;
    entidad_tipo?: string; // Tipo de entidad relacionada: 'espacio', 'reserva', 'producto', etc.
    entidad_id?: string; // ID de la entidad relacionada
    metadata?: Json; // Datos adicionales en formato JSON
    created_at: string;
    updated_at: string;
}

// Tabla de Incidencias
export interface Incidencia {
    id: string;
    titulo: string;
    descripcion: string;
    estado: 'abierta' | 'en_progreso' | 'resuelta' | 'cerrada';
    prioridad: 'baja' | 'media' | 'alta' | 'critica';
    tipo?: string; // Tipo de incidencia: 'tecnica', 'operativa', 'cliente', etc.
    reportado_por?: string; // ID del usuario que reportó
    asignado_a?: string; // ID del usuario asignado
    entidad_tipo?: string; // Tipo de entidad relacionada
    entidad_id?: string; // ID de la entidad relacionada
    fecha_reporte: string;
    fecha_resolucion?: string;
    metadata?: Json; // Datos adicionales en formato JSON
    created_at: string;
    updated_at: string;
}

// Tabla de Instalaciones
export interface Instalacion {
    id: string;
    nombre: string;
    tipo: string; // Tipo de instalación: 'hardware', 'software', 'infraestructura', etc.
    ubicacion?: string;
    estado: 'planificada' | 'en_progreso' | 'completada' | 'cancelada';
    fecha_planificada: string;
    fecha_instalacion?: string;
    tecnico_id?: string; // ID del técnico responsable
    cliente_id?: string; // ID del cliente
    equipos?: Json; // Lista de equipos instalados
    notas?: string;
    metadata?: Json; // Datos adicionales en formato JSON
    created_at: string;
    updated_at: string;
}

// Definición de la base de datos
export interface MetricsDatabase {
    public: {
        Tables: {
            metricas: {
                Row: Metrica;
                Insert: Omit<Metrica, 'id' | 'created_at' | 'updated_at'> & {
                    id?: string;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: Partial<Omit<Metrica, 'id' | 'created_at' | 'updated_at'>>;
            };
            incidencias: {
                Row: Incidencia;
                Insert: Omit<Incidencia, 'id' | 'created_at' | 'updated_at'> & {
                    id?: string;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: Partial<Omit<Incidencia, 'id' | 'created_at' | 'updated_at'>>;
            };
            instalaciones: {
                Row: Instalacion;
                Insert: Omit<Instalacion, 'id' | 'created_at' | 'updated_at'> & {
                    id?: string;
                    created_at?: string;
                    updated_at?: string;
                };
                Update: Partial<Omit<Instalacion, 'id' | 'created_at' | 'updated_at'>>;
            };
        };
        Views: {};
        Functions: {};
        Enums: {};
    };
}
