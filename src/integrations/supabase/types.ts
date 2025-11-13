export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      asignaciones_turno: {
        Row: {
          asignacion_automatica: boolean | null
          created_at: string | null
          fecha: string
          id: string
          notas: string | null
          posicion_sala_id: string | null
          sala_id: string | null
          trabajador_id: string
          turno_id: string
          updated_at: string | null
        }
        Insert: {
          asignacion_automatica?: boolean | null
          created_at?: string | null
          fecha: string
          id?: string
          notas?: string | null
          posicion_sala_id?: string | null
          sala_id?: string | null
          trabajador_id: string
          turno_id: string
          updated_at?: string | null
        }
        Update: {
          asignacion_automatica?: boolean | null
          created_at?: string | null
          fecha?: string
          id?: string
          notas?: string | null
          posicion_sala_id?: string | null
          sala_id?: string | null
          trabajador_id?: string
          turno_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asignaciones_turno_posicion_sala_id_fkey"
            columns: ["posicion_sala_id"]
            isOneToOne: false
            referencedRelation: "posiciones_sala"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_turno_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_turno_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_turno_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          apellidos: string | null
          created_at: string | null
          email: string | null
          id: string
          nombre: string
          preferencias: Json | null
          telefono: string
          updated_at: string | null
          vip: boolean | null
        }
        Insert: {
          apellidos?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nombre: string
          preferencias?: Json | null
          telefono: string
          updated_at?: string | null
          vip?: boolean | null
        }
        Update: {
          apellidos?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          nombre?: string
          preferencias?: Json | null
          telefono?: string
          updated_at?: string | null
          vip?: boolean | null
        }
        Relationships: []
      }
      historial_reservas: {
        Row: {
          comentario: string | null
          created_at: string | null
          estado_anterior: string | null
          estado_nuevo: string
          id: string
          modificado_por: string | null
          reserva_id: string
        }
        Insert: {
          comentario?: string | null
          created_at?: string | null
          estado_anterior?: string | null
          estado_nuevo: string
          id?: string
          modificado_por?: string | null
          reserva_id: string
        }
        Update: {
          comentario?: string | null
          created_at?: string | null
          estado_anterior?: string | null
          estado_nuevo?: string
          id?: string
          modificado_por?: string | null
          reserva_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historial_reservas_modificado_por_fkey"
            columns: ["modificado_por"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_reservas_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "reservas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_reservas_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "vista_reservas_pendientes"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_ocupacion: {
        Row: {
          capacidad_utilizada: number | null
          created_at: string | null
          fecha: string
          id: string
          ingresos_estimados: number | null
          sala_id: string
          total_comensales: number | null
          total_reservas: number | null
          turno_id: string
        }
        Insert: {
          capacidad_utilizada?: number | null
          created_at?: string | null
          fecha: string
          id?: string
          ingresos_estimados?: number | null
          sala_id: string
          total_comensales?: number | null
          total_reservas?: number | null
          turno_id: string
        }
        Update: {
          capacidad_utilizada?: number | null
          created_at?: string | null
          fecha?: string
          id?: string
          ingresos_estimados?: number | null
          sala_id?: string
          total_comensales?: number | null
          total_reservas?: number | null
          turno_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historico_ocupacion_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_ocupacion_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
        ]
      }
      metricas_productividad: {
        Row: {
          comensales_atendidos: number | null
          created_at: string | null
          fecha: string
          id: string
          mesas_atendidas: number | null
          notas: string | null
          tiempo_promedio_atencion: unknown
          trabajador_id: string
          turno_id: string
          valoracion_servicio: number | null
        }
        Insert: {
          comensales_atendidos?: number | null
          created_at?: string | null
          fecha: string
          id?: string
          mesas_atendidas?: number | null
          notas?: string | null
          tiempo_promedio_atencion?: unknown
          trabajador_id: string
          turno_id: string
          valoracion_servicio?: number | null
        }
        Update: {
          comensales_atendidos?: number | null
          created_at?: string | null
          fecha?: string
          id?: string
          mesas_atendidas?: number | null
          notas?: string | null
          tiempo_promedio_atencion?: unknown
          trabajador_id?: string
          turno_id?: string
          valoracion_servicio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metricas_productividad_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metricas_productividad_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
        ]
      }
      posiciones_sala: {
        Row: {
          activa: boolean | null
          capacidad_comensales: number
          created_at: string | null
          descripcion: string | null
          id: string
          nombre: string
          orden_prioridad: number | null
          sala_id: string
          updated_at: string | null
        }
        Insert: {
          activa?: boolean | null
          capacidad_comensales: number
          created_at?: string | null
          descripcion?: string | null
          id?: string
          nombre: string
          orden_prioridad?: number | null
          sala_id: string
          updated_at?: string | null
        }
        Update: {
          activa?: boolean | null
          capacidad_comensales?: number
          created_at?: string | null
          descripcion?: string | null
          id?: string
          nombre?: string
          orden_prioridad?: number | null
          sala_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posiciones_sala_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas: {
        Row: {
          cliente_id: string | null
          created_at: string | null
          estado: string
          fecha: string
          fecha_confirmacion: string | null
          fecha_verificacion: string | null
          hora: string
          id: string
          notas_cliente: string | null
          notas_internas: string | null
          numero_comensales: number
          posicion_sala_id: string | null
          sala_id: string
          turno_id: string
          updated_at: string | null
          verificada_por: string | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string | null
          estado?: string
          fecha: string
          fecha_confirmacion?: string | null
          fecha_verificacion?: string | null
          hora: string
          id?: string
          notas_cliente?: string | null
          notas_internas?: string | null
          numero_comensales: number
          posicion_sala_id?: string | null
          sala_id: string
          turno_id: string
          updated_at?: string | null
          verificada_por?: string | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string | null
          estado?: string
          fecha?: string
          fecha_confirmacion?: string | null
          fecha_verificacion?: string | null
          hora?: string
          id?: string
          notas_cliente?: string | null
          notas_internas?: string | null
          numero_comensales?: number
          posicion_sala_id?: string | null
          sala_id?: string
          turno_id?: string
          updated_at?: string | null
          verificada_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_posicion_sala_id_fkey"
            columns: ["posicion_sala_id"]
            isOneToOne: false
            referencedRelation: "posiciones_sala"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_verificada_por_fkey"
            columns: ["verificada_por"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      salas: {
        Row: {
          activa: boolean | null
          capacidad_maxima: number
          caracteristicas: Json | null
          created_at: string | null
          descripcion: string | null
          id: string
          nombre: string
          numero_mesas: number
          updated_at: string | null
        }
        Insert: {
          activa?: boolean | null
          capacidad_maxima: number
          caracteristicas?: Json | null
          created_at?: string | null
          descripcion?: string | null
          id?: string
          nombre: string
          numero_mesas: number
          updated_at?: string | null
        }
        Update: {
          activa?: boolean | null
          capacidad_maxima?: number
          caracteristicas?: Json | null
          created_at?: string | null
          descripcion?: string | null
          id?: string
          nombre?: string
          numero_mesas?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      trabajadores: {
        Row: {
          activo: boolean | null
          apellidos: string
          created_at: string | null
          email: string
          fecha_contratacion: string
          id: string
          nombre: string
          rol: string
          telefono: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          apellidos: string
          created_at?: string | null
          email: string
          fecha_contratacion?: string
          id?: string
          nombre: string
          rol: string
          telefono?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          apellidos?: string
          created_at?: string | null
          email?: string
          fecha_contratacion?: string
          id?: string
          nombre?: string
          rol?: string
          telefono?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      turnos: {
        Row: {
          activo: boolean | null
          created_at: string | null
          dias_semana: number[]
          hora_fin: string
          hora_inicio: string
          id: string
          nombre: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          dias_semana: number[]
          hora_fin: string
          hora_inicio: string
          id?: string
          nombre: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          dias_semana?: number[]
          hora_fin?: string
          hora_inicio?: string
          id?: string
          nombre?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      vista_ocupacion_salas: {
        Row: {
          capacidad_maxima: number | null
          fecha: string | null
          porcentaje_ocupacion: number | null
          sala: string | null
          total_comensales: number | null
          total_reservas: number | null
          turno: string | null
        }
        Relationships: []
      }
      vista_reservas_pendientes: {
        Row: {
          email: string | null
          fecha: string | null
          fecha_solicitud: string | null
          hora: string | null
          id: string | null
          nombre_cliente: string | null
          numero_comensales: number | null
          sala: string | null
          telefono: string | null
          turno: string | null
        }
        Relationships: []
      }
      vista_trabajadores_hoy: {
        Row: {
          fecha: string | null
          posicion: string | null
          rol: string | null
          sala: string | null
          trabajador: string | null
          turno: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
