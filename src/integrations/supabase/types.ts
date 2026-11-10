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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alertas_stock: {
        Row: {
          created_at: string | null
          id: string
          notificar_email: boolean | null
          producto_id: string
          producto_tipo: string
          stock_minimo: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notificar_email?: boolean | null
          producto_id: string
          producto_tipo: string
          stock_minimo?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notificar_email?: boolean | null
          producto_id?: string
          producto_tipo?: string
          stock_minimo?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      areas_trabajo: {
        Row: {
          activa: boolean | null
          created_at: string | null
          descripcion: string | null
          id: string
          nombre: string
          tipo: string | null
          updated_at: string | null
        }
        Insert: {
          activa?: boolean | null
          created_at?: string | null
          descripcion?: string | null
          id?: string
          nombre: string
          tipo?: string | null
          updated_at?: string | null
        }
        Update: {
          activa?: boolean | null
          created_at?: string | null
          descripcion?: string | null
          id?: string
          nombre?: string
          tipo?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      asignaciones_area: {
        Row: {
          area_id: string
          created_at: string | null
          id: string
          turno_id: string
        }
        Insert: {
          area_id: string
          created_at?: string | null
          id?: string
          turno_id: string
        }
        Update: {
          area_id?: string
          created_at?: string | null
          id?: string
          turno_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asignaciones_area_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas_trabajo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_area_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_area_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "vista_turnos_con_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      ajustes_mesa_servicio: {
        Row: {
          espacio_id: string
          fecha: string
          id: string
          mesa_id: string
          picos: number
          piezas: number
          plazas: number | null
          turno: string
          unida_a: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          espacio_id: string
          fecha: string
          id?: string
          mesa_id: string
          picos?: number
          piezas: number
          plazas?: number | null
          turno: string
          unida_a?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          espacio_id?: string
          fecha?: string
          id?: string
          mesa_id?: string
          picos?: number
          piezas?: number
          plazas?: number | null
          turno?: string
          unida_a?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ajustes_mesa_servicio_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ajustes_mesa_servicio_mesa_id_fkey"
            columns: ["mesa_id"]
            isOneToOne: false
            referencedRelation: "mesas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ajustes_mesa_servicio_unida_a_fkey"
            columns: ["unida_a"]
            isOneToOne: false
            referencedRelation: "mesas"
            referencedColumns: ["id"]
          },
        ]
      }
      asignaciones_mesa: {
        Row: {
          asignada_por: string | null
          created_at: string | null
          espacio_id: string | null
          fecha: string | null
          id: string
          mesa_id: string
          reserva_id: string
          turno: string | null
        }
        Insert: {
          asignada_por?: string | null
          created_at?: string | null
          espacio_id?: string | null
          fecha?: string | null
          id?: string
          mesa_id: string
          reserva_id: string
          turno?: string | null
        }
        Update: {
          asignada_por?: string | null
          created_at?: string | null
          espacio_id?: string | null
          fecha?: string | null
          id?: string
          mesa_id?: string
          reserva_id?: string
          turno?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asignaciones_mesa_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_mesa_mesa_id_fkey"
            columns: ["mesa_id"]
            isOneToOne: false
            referencedRelation: "mesas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_mesa_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "reservas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_mesa_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "vista_reservas_pendientes"
            referencedColumns: ["id"]
          },
        ]
      }
      asignaciones_mesa_descartadas: {
        Row: {
          descartada_at: string | null
          espacio_id: string | null
          fecha: string | null
          id: string
          mesa_id: string | null
          mesa_nombre: string | null
          motivo: string | null
          reserva_id: string | null
          turno: string | null
        }
        Insert: {
          descartada_at?: string | null
          espacio_id?: string | null
          fecha?: string | null
          id?: string
          mesa_id?: string | null
          mesa_nombre?: string | null
          motivo?: string | null
          reserva_id?: string | null
          turno?: string | null
        }
        Update: {
          descartada_at?: string | null
          espacio_id?: string | null
          fecha?: string | null
          id?: string
          mesa_id?: string | null
          mesa_nombre?: string | null
          motivo?: string | null
          reserva_id?: string | null
          turno?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asignaciones_mesa_descartadas_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_mesa_descartadas_mesa_id_fkey"
            columns: ["mesa_id"]
            isOneToOne: false
            referencedRelation: "mesas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_mesa_descartadas_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "reservas"
            referencedColumns: ["id"]
          },
        ]
      }
      asignaciones_sala: {
        Row: {
          created_at: string | null
          id: string
          sala_id: string
          turno_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          sala_id: string
          turno_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          sala_id?: string
          turno_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asignaciones_sala_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignaciones_sala_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "vista_turnos_con_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      Bebidas: {
        Row: {
          activado: boolean | null
          categoria: string | null
          categoria_en: string | null
          categoria_fr: string | null
          created_at: string | null
          descripcion: string | null
          descripcion_en: string | null
          descripcion_fr: string | null
          featured: boolean | null
          id: string
          imagen_url: string | null
          nombre: string | null
          nombre_en: string | null
          nombre_fr: string | null
          orden: number | null
          precio_eur: number | null
          restaurante: boolean | null
          tag: string | null
          tamano: string | null
          tipo: string | null
          touza: boolean | null
          traducciones: Json | null
          updated_at: string | null
        }
        Insert: {
          activado?: boolean | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          featured?: boolean | null
          id: string
          imagen_url?: string | null
          nombre?: string | null
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: number | null
          precio_eur?: number | null
          restaurante?: boolean | null
          tag?: string | null
          tamano?: string | null
          tipo?: string | null
          touza?: boolean | null
          traducciones?: Json | null
          updated_at?: string | null
        }
        Update: {
          activado?: boolean | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          featured?: boolean | null
          id?: string
          imagen_url?: string | null
          nombre?: string | null
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: number | null
          precio_eur?: number | null
          restaurante?: boolean | null
          tag?: string | null
          tamano?: string | null
          tipo?: string | null
          touza?: boolean | null
          traducciones?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      BebidasVENTA: {
        Row: {
          activado: boolean | null
          categoria: string | null
          categoria_en: string | null
          categoria_fr: string | null
          created_at: string | null
          denominacion_origen: string | null
          descripcion: string | null
          descripcion_en: string | null
          descripcion_fr: string | null
          featured: boolean | null
          id: string
          imagen_url: string | null
          nombre: string
          nombre_en: string | null
          nombre_fr: string | null
          orden: number | null
          precio_coste: number | null
          precio_eur: number | null
          stock: number | null
          ubicacion_pais: string | null
          ubicacion_region: string | null
          updated_at: string | null
        }
        Insert: {
          activado?: boolean | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          denominacion_origen?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          featured?: boolean | null
          id?: string
          imagen_url?: string | null
          nombre: string
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: number | null
          precio_coste?: number | null
          precio_eur?: number | null
          stock?: number | null
          ubicacion_pais?: string | null
          ubicacion_region?: string | null
          updated_at?: string | null
        }
        Update: {
          activado?: boolean | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          denominacion_origen?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          featured?: boolean | null
          id?: string
          imagen_url?: string | null
          nombre?: string
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: number | null
          precio_coste?: number | null
          precio_eur?: number | null
          stock?: number | null
          ubicacion_pais?: string | null
          ubicacion_region?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      avisos_reserva_enviados: {
        Row: {
          clave: string
          creado_at: string | null
          reserva_id: string
        }
        Insert: {
          clave: string
          creado_at?: string | null
          reserva_id: string
        }
        Update: {
          clave?: string
          creado_at?: string | null
          reserva_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avisos_reserva_enviados_reserva_id_fkey"
            columns: ["reserva_id"]
            isOneToOne: false
            referencedRelation: "reservas"
            referencedColumns: ["id"]
          },
        ]
      }
      bew: {
        Row: {
          activado: boolean | null
          alergenos_inferidos: Json | null
          alergenos_notas: string | null
          alergenos_oficiales: Json | null
          categoria: string | null
          contiene_carne: boolean | null
          contiene_gluten: boolean | null
          contiene_huevo: boolean | null
          contiene_lacteos: boolean | null
          contiene_lactosa: boolean | null
          contiene_marisco: boolean | null
          contiene_pescado: boolean | null
          created_at: string | null
          descripcion: string | null
          id: string | null
          imagen_url: string | null
          nombre: string | null
          orden: string | null
          precio_eur: number | null
          unidad: string | null
          updated_at: string | null
        }
        Insert: {
          activado?: boolean | null
          alergenos_inferidos?: Json | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          categoria?: string | null
          contiene_carne?: boolean | null
          contiene_gluten?: boolean | null
          contiene_huevo?: boolean | null
          contiene_lacteos?: boolean | null
          contiene_lactosa?: boolean | null
          contiene_marisco?: boolean | null
          contiene_pescado?: boolean | null
          created_at?: string | null
          descripcion?: string | null
          id?: string | null
          imagen_url?: string | null
          nombre?: string | null
          orden?: string | null
          precio_eur?: number | null
          unidad?: string | null
          updated_at?: string | null
        }
        Update: {
          activado?: boolean | null
          alergenos_inferidos?: Json | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          categoria?: string | null
          contiene_carne?: boolean | null
          contiene_gluten?: boolean | null
          contiene_huevo?: boolean | null
          contiene_lacteos?: boolean | null
          contiene_lactosa?: boolean | null
          contiene_marisco?: boolean | null
          contiene_pescado?: boolean | null
          created_at?: string | null
          descripcion?: string | null
          id?: string | null
          imagen_url?: string | null
          nombre?: string | null
          orden?: string | null
          precio_eur?: number | null
          unidad?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      blacklist: {
        Row: {
          created_at: string
          id: string
          motivo: string | null
          nombre: string | null
          tipo: string
          updated_at: string
          valor: string
        }
        Insert: {
          created_at?: string
          id?: string
          motivo?: string | null
          nombre?: string | null
          tipo: string
          updated_at?: string
          valor: string
        }
        Update: {
          created_at?: string
          id?: string
          motivo?: string | null
          nombre?: string | null
          tipo?: string
          updated_at?: string
          valor?: string
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          audio_metrics: Json | null
          call_success: boolean | null
          call_type: string | null
          caller_number: string | null
          cost_breakdown: Json | null
          cost_total_eur: number | null
          cost_total_usd: number | null
          created_at: string | null
          duration_seconds: number | null
          ended_at: string | null
          ended_reason: string | null
          id: string
          reservation_extraction: Json | null
          restaurant_id: string
          sentiment: string | null
          started_at: string | null
          status: string | null
          structured_data: Json | null
          structured_outputs: Json | null
          success_evaluation: string | null
          summary: string | null
          tool_calls: Json | null
          vapi_call_id: string | null
        }
        Insert: {
          audio_metrics?: Json | null
          call_success?: boolean | null
          call_type?: string | null
          caller_number?: string | null
          cost_breakdown?: Json | null
          cost_total_eur?: number | null
          cost_total_usd?: number | null
          created_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          reservation_extraction?: Json | null
          restaurant_id: string
          sentiment?: string | null
          started_at?: string | null
          status?: string | null
          structured_data?: Json | null
          structured_outputs?: Json | null
          success_evaluation?: string | null
          summary?: string | null
          tool_calls?: Json | null
          vapi_call_id?: string | null
        }
        Update: {
          audio_metrics?: Json | null
          call_success?: boolean | null
          call_type?: string | null
          caller_number?: string | null
          cost_breakdown?: Json | null
          cost_total_eur?: number | null
          cost_total_usd?: number | null
          created_at?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          reservation_extraction?: Json | null
          restaurant_id?: string
          sentiment?: string | null
          started_at?: string | null
          status?: string | null
          structured_data?: Json | null
          structured_outputs?: Json | null
          success_evaluation?: string | null
          summary?: string | null
          tool_calls?: Json | null
          vapi_call_id?: string | null
        }
        Relationships: []
      }
      campanas_marketing: {
        Row: {
          canal: string
          clics: number | null
          created_at: string | null
          estado: string | null
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          nombre: string
          presupuesto: number | null
          reservas_generadas: number | null
          updated_at: string | null
          visitas_web: number | null
        }
        Insert: {
          canal: string
          clics?: number | null
          created_at?: string | null
          estado?: string | null
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          nombre: string
          presupuesto?: number | null
          reservas_generadas?: number | null
          updated_at?: string | null
          visitas_web?: number | null
        }
        Update: {
          canal?: string
          clics?: number | null
          created_at?: string | null
          estado?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          nombre?: string
          presupuesto?: number | null
          reservas_generadas?: number | null
          updated_at?: string | null
          visitas_web?: number | null
        }
        Relationships: []
      }
      carrito: {
        Row: {
          cantidad: number
          created_at: string
          id: string
          producto_id: string
          producto_tipo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cantidad?: number
          created_at?: string
          id?: string
          producto_id: string
          producto_tipo?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          id?: string
          producto_id?: string
          producto_tipo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      carta_fotos_originales: {
        Row: {
          alto: number
          ancho: number
          bytes: number
          created_at: string
          drive_id: string
          id: string
          marca: string
          nombre: string
          plato_id: string | null
          subido_por: string | null
          updated_at: string
          vino_id: string | null
        }
        Insert: {
          alto: number
          ancho: number
          bytes: number
          created_at?: string
          drive_id: string
          id?: string
          marca: string
          nombre: string
          plato_id?: string | null
          subido_por?: string | null
          updated_at?: string
          vino_id?: string | null
        }
        Update: {
          alto?: number
          ancho?: number
          bytes?: number
          created_at?: string
          drive_id?: string
          id?: string
          marca?: string
          nombre?: string
          plato_id?: string | null
          subido_por?: string | null
          updated_at?: string
          vino_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carta_fotos_originales_plato_id_fkey"
            columns: ["plato_id"]
            isOneToOne: true
            referencedRelation: "Platos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carta_fotos_originales_vino_id_fkey"
            columns: ["vino_id"]
            isOneToOne: true
            referencedRelation: "Vinos"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_producto: {
        Row: {
          activa: boolean
          clave: string | null
          created_at: string
          descripcion: string | null
          id: number
          nombre: string
          orden: number
          padre_id: number | null
          updated_at: string
        }
        Insert: {
          activa?: boolean
          clave?: string | null
          created_at?: string
          descripcion?: string | null
          id?: never
          nombre: string
          orden?: number
          padre_id?: number | null
          updated_at?: string
        }
        Update: {
          activa?: boolean
          clave?: string | null
          created_at?: string
          descripcion?: string | null
          id?: never
          nombre?: string
          orden?: number
          padre_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_producto_padre_id_fkey"
            columns: ["padre_id"]
            isOneToOne: false
            referencedRelation: "categorias_producto"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_web_config: {
        Row: {
          activo: boolean
          alerta_pct: number
          duracion_max_min: number
          id: boolean
          max_chars: number
          max_output_tokens: number
          max_req_dia: number
          max_req_ip_hora: number
          max_req_sesion_hora: number
          max_turnos: number
          presupuesto_dia_usd: number
          telefono: string
          updated_at: string
          url_reservas: string | null
        }
        Insert: {
          activo?: boolean
          alerta_pct?: number
          duracion_max_min?: number
          id?: boolean
          max_chars?: number
          max_output_tokens?: number
          max_req_dia?: number
          max_req_ip_hora?: number
          max_req_sesion_hora?: number
          max_turnos?: number
          presupuesto_dia_usd?: number
          telefono?: string
          updated_at?: string
          url_reservas?: string | null
        }
        Update: {
          activo?: boolean
          alerta_pct?: number
          duracion_max_min?: number
          id?: boolean
          max_chars?: number
          max_output_tokens?: number
          max_req_dia?: number
          max_req_ip_hora?: number
          max_req_sesion_hora?: number
          max_turnos?: number
          presupuesto_dia_usd?: number
          telefono?: string
          updated_at?: string
          url_reservas?: string | null
        }
        Relationships: []
      }
      client_messages: {
        Row: {
          client_id: string
          created_at: string
          file_name: string | null
          file_url: string | null
          id: string
          is_read: boolean
          message: string
          sender_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          is_read?: boolean
          message?: string
          sender_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          is_read?: boolean
          message?: string
          sender_id?: string
        }
        Relationships: []
      }
      Cocteles: {
        Row: {
          activado: boolean | null
          alergenos_notas: string | null
          alergenos_oficiales: Json | null
          base: string | null
          categoria: string | null
          categoria_en: string | null
          categoria_fr: string | null
          created_at: string | null
          descripcion: string | null
          descripcion_en: string | null
          descripcion_fr: string | null
          featured: boolean | null
          id: string
          imagen_url: string | null
          ingredientes: string | null
          ingredientes_en: string | null
          ingredientes_fr: string | null
          nombre: string | null
          nombre_en: string | null
          nombre_fr: string | null
          orden: number | null
          precio_eur: number | null
          preparacion: string | null
          restaurante: boolean | null
          touza: boolean | null
          traducciones: Json | null
          updated_at: string | null
        }
        Insert: {
          activado?: boolean | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          base?: string | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          featured?: boolean | null
          id?: string
          imagen_url?: string | null
          ingredientes?: string | null
          ingredientes_en?: string | null
          ingredientes_fr?: string | null
          nombre?: string | null
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: number | null
          precio_eur?: number | null
          preparacion?: string | null
          restaurante?: boolean | null
          touza?: boolean | null
          traducciones?: Json | null
          updated_at?: string | null
        }
        Update: {
          activado?: boolean | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          base?: string | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          featured?: boolean | null
          id?: string
          imagen_url?: string | null
          ingredientes?: string | null
          ingredientes_en?: string | null
          ingredientes_fr?: string | null
          nombre?: string | null
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: number | null
          precio_eur?: number | null
          preparacion?: string | null
          restaurante?: boolean | null
          touza?: boolean | null
          traducciones?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ComidaVENTA: {
        Row: {
          activado: boolean | null
          categoria: string | null
          categoria_en: string | null
          categoria_fr: string | null
          created_at: string | null
          descripcion: string | null
          descripcion_en: string | null
          descripcion_fr: string | null
          featured: boolean | null
          id: string
          imagen_url: string | null
          nombre: string
          nombre_en: string | null
          nombre_fr: string | null
          orden: number | null
          origen: string | null
          peso: string | null
          precio_coste: number | null
          precio_eur: number | null
          stock: number | null
          updated_at: string | null
        }
        Insert: {
          activado?: boolean | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          featured?: boolean | null
          id?: string
          imagen_url?: string | null
          nombre: string
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: number | null
          origen?: string | null
          peso?: string | null
          precio_coste?: number | null
          precio_eur?: number | null
          stock?: number | null
          updated_at?: string | null
        }
        Update: {
          activado?: boolean | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          featured?: boolean | null
          id?: string
          imagen_url?: string | null
          nombre?: string
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: number | null
          origen?: string | null
          peso?: string | null
          precio_coste?: number | null
          precio_eur?: number | null
          stock?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      config_google_places: {
        Row: {
          created_at: string | null
          direccion: string | null
          id: string
          place_id: string
          place_name: string
          rating_promedio: number | null
          telefono: string | null
          total_resenas: number | null
          ultima_sincronizacion: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          created_at?: string | null
          direccion?: string | null
          id?: string
          place_id: string
          place_name: string
          rating_promedio?: number | null
          telefono?: string | null
          total_resenas?: number | null
          ultima_sincronizacion?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          created_at?: string | null
          direccion?: string | null
          id?: string
          place_id?: string
          place_name?: string
          rating_promedio?: number | null
          telefono?: string | null
          total_resenas?: number | null
          ultima_sincronizacion?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      config_redes_sociales: {
        Row: {
          access_token: string | null
          account_id: string | null
          activo: boolean | null
          created_at: string | null
          id: string
          page_id: string | null
          red_social: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          access_token?: string | null
          account_id?: string | null
          activo?: boolean | null
          created_at?: string | null
          id?: string
          page_id?: string | null
          red_social: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_token?: string | null
          account_id?: string | null
          activo?: boolean | null
          created_at?: string | null
          id?: string
          page_id?: string | null
          red_social?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      configBotWeb: {
        Row: {
          created_at: string
          frases_personalizadas: string | null
          id: string
          idioma: string | null
          instrucciones_extra: string | null
          mensaje_bienvenida: string | null
          platos_recomendados: string | null
          tono: string | null
          updated_at: string
          vinos_recomendados: string | null
        }
        Insert: {
          created_at?: string
          frases_personalizadas?: string | null
          id?: string
          idioma?: string | null
          instrucciones_extra?: string | null
          mensaje_bienvenida?: string | null
          platos_recomendados?: string | null
          tono?: string | null
          updated_at?: string
          vinos_recomendados?: string | null
        }
        Update: {
          created_at?: string
          frases_personalizadas?: string | null
          id?: string
          idioma?: string | null
          instrucciones_extra?: string | null
          mensaje_bienvenida?: string | null
          platos_recomendados?: string | null
          tono?: string | null
          updated_at?: string
          vinos_recomendados?: string | null
        }
        Relationships: []
      }
      configuracion_reservas: {
        Row: {
          asignacion_aviso_activo: boolean
          asignacion_espacios_excluidos: string[]
          asignacion_mesas_excluidas: string[]
          asignacion_mesas_al_final: string[]
          asignacion_ventana_horas: number
          auto_confirmar: boolean
          created_at: string
          dias_max_antelacion: number
          email_obligatorio: boolean
          estancia_cena_minutos: number
          estancia_comida_minutos: number
          id: string
          max_comensales_por_reserva: number
          max_reservas_por_email_dia: number
          max_reservas_por_telefono_dia: number
          min_comensales_por_reserva: number
          minutos_corte_antes_servicio: number
          retraso_gracia_minutos: number
          telefono_obligatorio: boolean
          updated_at: string
        }
        Insert: {
          asignacion_aviso_activo?: boolean
          asignacion_espacios_excluidos?: string[]
          asignacion_mesas_excluidas?: string[]
          asignacion_mesas_al_final?: string[]
          asignacion_ventana_horas?: number
          auto_confirmar?: boolean
          created_at?: string
          dias_max_antelacion?: number
          email_obligatorio?: boolean
          estancia_cena_minutos?: number
          estancia_comida_minutos?: number
          id?: string
          max_comensales_por_reserva?: number
          max_reservas_por_email_dia?: number
          max_reservas_por_telefono_dia?: number
          min_comensales_por_reserva?: number
          minutos_corte_antes_servicio?: number
          retraso_gracia_minutos?: number
          telefono_obligatorio?: boolean
          updated_at?: string
        }
        Update: {
          asignacion_aviso_activo?: boolean
          asignacion_espacios_excluidos?: string[]
          asignacion_mesas_excluidas?: string[]
          asignacion_mesas_al_final?: string[]
          asignacion_ventana_horas?: number
          auto_confirmar?: boolean
          created_at?: string
          dias_max_antelacion?: number
          email_obligatorio?: boolean
          estancia_cena_minutos?: number
          estancia_comida_minutos?: number
          id?: string
          max_comensales_por_reserva?: number
          max_reservas_por_email_dia?: number
          max_reservas_por_telefono_dia?: number
          min_comensales_por_reserva?: number
          minutos_corte_antes_servicio?: number
          retraso_gracia_minutos?: number
          telefono_obligatorio?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      configuracion_turnos: {
        Row: {
          activo: boolean
          created_at: string
          dias_semana: number[]
          espacio_id: string | null
          hora_fin: string
          hora_inicio: string
          horas_fijas: string[] | null
          id: string
          intervalo_base_minutos: number
          nombre_periodo: string
          ocultar_primario_si_secundario: boolean
          umbral_apertura_secundario: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          dias_semana?: number[]
          espacio_id?: string | null
          hora_fin: string
          hora_inicio: string
          horas_fijas?: string[] | null
          id?: string
          intervalo_base_minutos?: number
          nombre_periodo: string
          ocultar_primario_si_secundario?: boolean
          umbral_apertura_secundario?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          dias_semana?: number[]
          espacio_id?: string | null
          hora_fin?: string
          hora_inicio?: string
          horas_fijas?: string[] | null
          id?: string
          intervalo_base_minutos?: number
          nombre_periodo?: string
          ocultar_primario_si_secundario?: boolean
          umbral_apertura_secundario?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "configuracion_turnos_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion_web: {
        Row: {
          encuesta_vinos_activa: boolean
          encuesta_vinos_fin: string | null
          encuesta_vinos_premio: string | null
          horario_menu_dia_casa_tomas: Json | null
          horario_tapas_casa_tomas: Json | null
          id: boolean
          mostrar_fotos_platos_casa_tomas: boolean
          mostrar_fotos_platos_touza: boolean
          mostrar_menu_dia_casa_tomas: boolean
          mostrar_tapas_casa_tomas: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          encuesta_vinos_activa?: boolean
          encuesta_vinos_fin?: string | null
          encuesta_vinos_premio?: string | null
          horario_menu_dia_casa_tomas?: Json | null
          horario_tapas_casa_tomas?: Json | null
          id?: boolean
          mostrar_fotos_platos_casa_tomas?: boolean
          mostrar_fotos_platos_touza?: boolean
          mostrar_menu_dia_casa_tomas?: boolean
          mostrar_tapas_casa_tomas?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          encuesta_vinos_activa?: boolean
          encuesta_vinos_fin?: string | null
          encuesta_vinos_premio?: string | null
          horario_menu_dia_casa_tomas?: Json | null
          horario_tapas_casa_tomas?: Json | null
          id?: boolean
          mostrar_fotos_platos_casa_tomas?: boolean
          mostrar_fotos_platos_touza?: boolean
          mostrar_menu_dia_casa_tomas?: boolean
          mostrar_tapas_casa_tomas?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      // «Vota tu vino favorito» (migración 20261104141000_encuesta_vino_favorito). La web vota con
      // la RPC votar_vino_favorito; el panel con «Gestor carta» lee y vacía.
      votos_vino_favorito: {
        Row: {
          acepta_bases: boolean
          contacto: string
          contacto_normalizado: string
          created_at: string
          id: string
          idioma: string
          nombre: string
          vino_id: string | null
          vino_nombre: string
        }
        Insert: {
          acepta_bases: boolean
          contacto: string
          contacto_normalizado: string
          created_at?: string
          id?: string
          idioma?: string
          nombre: string
          vino_id?: string | null
          vino_nombre: string
        }
        Update: {
          acepta_bases?: boolean
          contacto?: string
          contacto_normalizado?: string
          created_at?: string
          id?: string
          idioma?: string
          nombre?: string
          vino_id?: string | null
          vino_nombre?: string
        }
        Relationships: []
      }
      // Tienda de vinos, escaparate (migración 20261103150000_tienda_vinos). Fila única (id = true).
      configuracion_tienda: {
        Row: {
          activa: boolean
          aviso: string | null
          descuento_pct: number
          id: boolean
          recogida: string | null
          updated_at: string
          updated_by: string | null
          vinos_excluidos: string[]
        }
        Insert: {
          activa?: boolean
          aviso?: string | null
          descuento_pct?: number
          id?: boolean
          recogida?: string | null
          updated_at?: string
          updated_by?: string | null
          vinos_excluidos?: string[]
        }
        Update: {
          activa?: boolean
          aviso?: string | null
          descuento_pct?: number
          id?: boolean
          recogida?: string | null
          updated_at?: string
          updated_by?: string | null
          vinos_excluidos?: string[]
        }
        Relationships: []
      }
      consultas_chatbot: {
        Row: {
          created_at: string | null
          embedding: string | null
          id: number
          pregunta: string
          respuesta: string | null
          resultados: Json | null
          sql_generado: string | null
        }
        Insert: {
          created_at?: string | null
          embedding?: string | null
          id?: number
          pregunta: string
          respuesta?: string | null
          resultados?: Json | null
          sql_generado?: string | null
        }
        Update: {
          created_at?: string | null
          embedding?: string | null
          id?: number
          pregunta?: string
          respuesta?: string | null
          resultados?: Json | null
          sql_generado?: string | null
        }
        Relationships: []
      }
      conversaciones: {
        Row: {
          created_at: string | null
          id: string
          session_id: string
          titulo: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          session_id: string
          titulo?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          session_id?: string
          titulo?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      costes_fijos: {
        Row: {
          activo: boolean
          actualizado_en: string
          categoria: string
          concepto: string
          creado_en: string
          eur_mes: number | null
          id: string
          naturaleza: string
          notas: string | null
          orden: number
          proveedor: string
          verificado_en: string | null
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          categoria: string
          concepto: string
          creado_en?: string
          eur_mes?: number | null
          id?: string
          naturaleza: string
          notas?: string | null
          orden?: number
          proveedor: string
          verificado_en?: string | null
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          categoria?: string
          concepto?: string
          creado_en?: string
          eur_mes?: number | null
          id?: string
          naturaleza?: string
          notas?: string | null
          orden?: number
          proveedor?: string
          verificado_en?: string | null
        }
        Relationships: []
      }
      dashboard_config: {
        Row: {
          created_at: string | null
          id: string
          is_default: boolean | null
          nombre_vista: string
          orden_widgets: Json
          updated_at: string | null
          user_id: string
          widgets_activos: Json
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          nombre_vista: string
          orden_widgets?: Json
          updated_at?: string | null
          user_id: string
          widgets_activos?: Json
        }
        Update: {
          created_at?: string | null
          id?: string
          is_default?: boolean | null
          nombre_vista?: string
          orden_widgets?: Json
          updated_at?: string | null
          user_id?: string
          widgets_activos?: Json
        }
        Relationships: []
      }
      documentos: {
        Row: {
          created_at: string
          fecha: string | null
          id: string
          importe_total: number | null
          moneda: string | null
          nombre_archivo: string | null
          numero_documento: string
          proveedor: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          fecha?: string | null
          id?: string
          importe_total?: number | null
          moneda?: string | null
          nombre_archivo?: string | null
          numero_documento: string
          proveedor?: string | null
          tipo: string
        }
        Update: {
          created_at?: string
          fecha?: string | null
          id?: string
          importe_total?: number | null
          moneda?: string | null
          nombre_archivo?: string | null
          numero_documento?: string
          proveedor?: string | null
          tipo?: string
        }
        Relationships: []
      }
      email_eventos: {
        Row: {
          created_at: string | null
          email_destinatario: string | null
          email_id: string
          id: string
          metadata: Json | null
          timestamp_evento: string | null
          tipo_evento: string
        }
        Insert: {
          created_at?: string | null
          email_destinatario?: string | null
          email_id: string
          id?: string
          metadata?: Json | null
          timestamp_evento?: string | null
          tipo_evento: string
        }
        Update: {
          created_at?: string | null
          email_destinatario?: string | null
          email_id?: string
          id?: string
          metadata?: Json | null
          timestamp_evento?: string | null
          tipo_evento?: string
        }
        Relationships: []
      }
      espacios_reserva: {
        Row: {
          activa: boolean | null
          capacidad_maxima: number
          caracteristicas: Json | null
          created_at: string | null
          descripcion: string | null
          id: string
          nombre: string
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
          updated_at?: string | null
        }
        Relationships: []
      }
      estadisticas_redes: {
        Row: {
          alcance: number | null
          comentarios_totales: number | null
          created_at: string | null
          engagement_rate: number | null
          fecha: string
          id: string
          likes_totales: number | null
          publicaciones_mes: number | null
          red_social: string
          seguidores: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          alcance?: number | null
          comentarios_totales?: number | null
          created_at?: string | null
          engagement_rate?: number | null
          fecha?: string
          id?: string
          likes_totales?: number | null
          publicaciones_mes?: number | null
          red_social: string
          seguidores?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          alcance?: number | null
          comentarios_totales?: number | null
          created_at?: string | null
          engagement_rate?: number | null
          fecha?: string
          id?: string
          likes_totales?: number | null
          publicaciones_mes?: number | null
          red_social?: string
          seguidores?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      facturas: {
        Row: {
          alertas_validacion: Json | null
          archivo_path: string | null
          cif: string | null
          created_at: string | null
          drive_url: string | null
          embedding: string | null
          embedding_observaciones: string | null
          facturado_en_id: number | null
          facturado_origen: string | null
          fecha: string
          id: number
          import_clave: string | null
          iva: number | null
          local: string | null
          numero_documento: string
          observaciones: string | null
          ocr_trabajo_id: string | null
          paginas: number
          procesado_en: string | null
          proveedor: string | null
          proveedor_id: number | null
          proveedor_normalizado: string | null
          resumen: string | null
          retencion_irpf: number | null
          retencion_irpf_pct: number | null
          subtotal: number | null
          tipo: string
          total: number | null
          total_origen: string | null
          updated_at: string | null
          verificada: boolean | null
          verificacion_origen: string | null
        }
        Insert: {
          alertas_validacion?: Json | null
          archivo_path?: string | null
          cif?: string | null
          created_at?: string | null
          drive_url?: string | null
          embedding?: string | null
          embedding_observaciones?: string | null
          facturado_en_id?: number | null
          facturado_origen?: string | null
          fecha: string
          id?: number
          import_clave?: string | null
          iva?: number | null
          local?: string | null
          numero_documento: string
          observaciones?: string | null
          ocr_trabajo_id?: string | null
          paginas?: number
          procesado_en?: string | null
          proveedor?: string | null
          proveedor_id?: number | null
          proveedor_normalizado?: string | null
          resumen?: string | null
          retencion_irpf?: number | null
          retencion_irpf_pct?: number | null
          subtotal?: number | null
          tipo: string
          total?: number | null
          total_origen?: string | null
          updated_at?: string | null
          verificada?: boolean | null
          verificacion_origen?: string | null
        }
        Update: {
          alertas_validacion?: Json | null
          archivo_path?: string | null
          cif?: string | null
          created_at?: string | null
          drive_url?: string | null
          embedding?: string | null
          embedding_observaciones?: string | null
          facturado_en_id?: number | null
          facturado_origen?: string | null
          fecha?: string
          id?: number
          import_clave?: string | null
          iva?: number | null
          local?: string | null
          numero_documento?: string
          observaciones?: string | null
          ocr_trabajo_id?: string | null
          paginas?: number
          procesado_en?: string | null
          proveedor?: string | null
          proveedor_id?: number | null
          proveedor_normalizado?: string | null
          resumen?: string | null
          retencion_irpf?: number | null
          retencion_irpf_pct?: number | null
          subtotal?: number | null
          tipo?: string
          total?: number | null
          total_origen?: string | null
          updated_at?: string | null
          verificada?: boolean | null
          verificacion_origen?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_ocr_trabajo_fk"
            columns: ["ocr_trabajo_id"]
            isOneToOne: true
            referencedRelation: "ocr_trabajos"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas_sustituciones: {
        Row: {
          factura_antes: Json
          factura_id: number
          historial_antes: Json
          id: number
          productos_antes: Json
          resumen_antes: Json
          resumen_despues: Json | null
          sustituida_at: string
          sustituida_por: string | null
          trabajo_id: string | null
        }
        Insert: {
          factura_antes: Json
          factura_id: number
          historial_antes: Json
          id?: number
          productos_antes: Json
          resumen_antes: Json
          resumen_despues?: Json | null
          sustituida_at?: string
          sustituida_por?: string | null
          trabajo_id?: string | null
        }
        Update: {
          factura_antes?: Json
          factura_id?: number
          historial_antes?: Json
          id?: number
          productos_antes?: Json
          resumen_antes?: Json
          resumen_despues?: Json | null
          sustituida_at?: string
          sustituida_por?: string | null
          trabajo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_sustituciones_trabajo_id_fkey"
            columns: ["trabajo_id"]
            isOneToOne: false
            referencedRelation: "ocr_trabajos"
            referencedColumns: ["id"]
          },
        ]
      }
      favoritos: {
        Row: {
          created_at: string
          id: string
          producto_id: string
          producto_tipo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          producto_id: string
          producto_tipo?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          producto_id?: string
          producto_tipo?: string
          user_id?: string
        }
        Relationships: []
      }
      gdpr_audit_log: {
        Row: {
          accion: string
          created_at: string | null
          detalles: Json | null
          ejecutado_por: string | null
          id: string
          registros_afectados: number | null
          tabla: string
        }
        Insert: {
          accion: string
          created_at?: string | null
          detalles?: Json | null
          ejecutado_por?: string | null
          id?: string
          registros_afectados?: number | null
          tabla: string
        }
        Update: {
          accion?: string
          created_at?: string | null
          detalles?: Json | null
          ejecutado_por?: string | null
          id?: string
          registros_afectados?: number | null
          tabla?: string
        }
        Relationships: []
      }
      gdpr_config: {
        Row: {
          accion: string
          activo: boolean | null
          campos_anonimizar: string[] | null
          created_at: string | null
          descripcion: string | null
          dias_retencion: number
          id: string
          tabla: string
          updated_at: string | null
        }
        Insert: {
          accion: string
          activo?: boolean | null
          campos_anonimizar?: string[] | null
          created_at?: string | null
          descripcion?: string | null
          dias_retencion: number
          id?: string
          tabla: string
          updated_at?: string | null
        }
        Update: {
          accion?: string
          activo?: boolean | null
          campos_anonimizar?: string[] | null
          created_at?: string | null
          descripcion?: string | null
          dias_retencion?: number
          id?: string
          tabla?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      historial_ajustes_precios: {
        Row: {
          categoria: string
          created_at: string
          fecha: string
          id: string
          items_afectados: number
          porcentaje: number
          snapshot: Json
          tipo_carta: string
          user_id: string | null
        }
        Insert: {
          categoria: string
          created_at?: string
          fecha?: string
          id?: string
          items_afectados?: number
          porcentaje: number
          snapshot?: Json
          tipo_carta: string
          user_id?: string | null
        }
        Update: {
          categoria?: string
          created_at?: string
          fecha?: string
          id?: string
          items_afectados?: number
          porcentaje?: number
          snapshot?: Json
          tipo_carta?: string
          user_id?: string | null
        }
        Relationships: []
      }
      historial_precios: {
        Row: {
          created_at: string | null
          factura_id: number | null
          fecha: string | null
          id: string
          precio: number | null
          producto_nombre: string | null
          proveedor: string | null
        }
        Insert: {
          created_at?: string | null
          factura_id?: number | null
          fecha?: string | null
          id?: string
          precio?: number | null
          producto_nombre?: string | null
          proveedor?: string | null
        }
        Update: {
          created_at?: string | null
          factura_id?: number | null
          fecha?: string | null
          id?: string
          precio?: number | null
          producto_nombre?: string | null
          proveedor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historial_precios_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_precios_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "vista_ultimos_documentos"
            referencedColumns: ["id"]
          },
        ]
      }
      imagenes_base64: {
        Row: {
          categoria: string | null
          contenido_base64: string
          created_at: string
          descripcion: string | null
          id: string
          nombre: string
          tamano_bytes: number | null
          tipo_mime: string
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          contenido_base64: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre: string
          tamano_bytes?: number | null
          tipo_mime: string
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          contenido_base64?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre?: string
          tamano_bytes?: number | null
          tipo_mime?: string
          updated_at?: string
        }
        Relationships: []
      }
      ia_coste_estimado: {
        Row: {
          funcion: string
          medido_en: string | null
          modelo: string | null
          nota: string | null
          unidad: string
          unidades_mes_estimadas: number
          usd_por_unidad: number
        }
        Insert: {
          funcion: string
          medido_en?: string | null
          modelo?: string | null
          nota?: string | null
          unidad?: string
          unidades_mes_estimadas: number
          usd_por_unidad: number
        }
        Update: {
          funcion?: string
          medido_en?: string | null
          modelo?: string | null
          nota?: string | null
          unidad?: string
          unidades_mes_estimadas?: number
          usd_por_unidad?: number
        }
        Relationships: []
      }
      ia_funciones: {
        Row: {
          activo: boolean
          descripcion: string
          funcion: string
          instrumentada: boolean
          orden: number
          unidad: string
        }
        Insert: {
          activo?: boolean
          descripcion: string
          funcion: string
          instrumentada?: boolean
          orden?: number
          unidad?: string
        }
        Update: {
          activo?: boolean
          descripcion?: string
          funcion?: string
          instrumentada?: boolean
          orden?: number
          unidad?: string
        }
        Relationships: []
      }
      ia_precios: {
        Row: {
          actualizado_en: string
          fuente: string | null
          modelo: string
          notas: string | null
          razonamiento_como_output: boolean
          usd_por_m_cache_write: number | null
          usd_por_m_cached: number | null
          usd_por_m_input: number
          usd_por_m_output: number
          verificado_en: string | null
        }
        Insert: {
          actualizado_en?: string
          fuente?: string | null
          modelo: string
          notas?: string | null
          razonamiento_como_output?: boolean
          usd_por_m_cache_write?: number | null
          usd_por_m_cached?: number | null
          usd_por_m_input: number
          usd_por_m_output: number
          verificado_en?: string | null
        }
        Update: {
          actualizado_en?: string
          fuente?: string | null
          modelo?: string
          notas?: string | null
          razonamiento_como_output?: boolean
          usd_por_m_cache_write?: number | null
          usd_por_m_cached?: number | null
          usd_por_m_input?: number
          usd_por_m_output?: number
          verificado_en?: string | null
        }
        Relationships: []
      }
      ia_uso: {
        Row: {
          cache_write_tokens: number
          cached_tokens: number
          completion_tokens: number
          coste_usd: number | null
          created_at: string
          disparador: string | null
          duracion_ms: number | null
          estado: string
          funcion: string
          id: number
          llamadas: number
          modelo: string
          operacion: string
          prompt_tokens: number
          razonamiento_tokens: number
        }
        Insert: {
          cache_write_tokens?: number
          cached_tokens?: number
          completion_tokens?: number
          coste_usd?: number | null
          created_at?: string
          disparador?: string | null
          duracion_ms?: number | null
          estado?: string
          funcion: string
          id?: never
          llamadas?: number
          modelo: string
          operacion?: string
          prompt_tokens?: number
          razonamiento_tokens?: number
        }
        Update: {
          cache_write_tokens?: number
          cached_tokens?: number
          completion_tokens?: number
          coste_usd?: number | null
          created_at?: string
          disparador?: string | null
          duracion_ms?: number | null
          estado?: string
          funcion?: string
          id?: never
          llamadas?: number
          modelo?: string
          operacion?: string
          prompt_tokens?: number
          razonamiento_tokens?: number
        }
        Relationships: []
      }
      instagram_fotos: {
        Row: {
          alto: number
          ancho: number
          created_at: string
          descripcion: string
          drive_id: string | null
          id: string
          marca: string
          ruta: string | null
          subida_por: string | null
          tipo: string
        }
        Insert: {
          alto: number
          ancho: number
          created_at?: string
          descripcion?: string
          drive_id?: string | null
          id?: string
          marca: string
          ruta?: string | null
          subida_por?: string | null
          tipo: string
        }
        Update: {
          alto?: number
          ancho?: number
          created_at?: string
          descripcion?: string
          drive_id?: string | null
          id?: string
          marca?: string
          ruta?: string | null
          subida_por?: string | null
          tipo?: string
        }
        Relationships: []
      }
      instagram_metricas_capturas: {
        Row: {
          avisos: Json
          dias: number
          error: string | null
          error_tipo: string | null
          fin: string | null
          id: number
          ig_user_id: string | null
          inicio: string
          ok: boolean
          origen: string
          publicaciones: number
        }
        Insert: {
          avisos?: Json
          dias?: number
          error?: string | null
          error_tipo?: string | null
          fin?: string | null
          id?: never
          ig_user_id?: string | null
          inicio?: string
          ok?: boolean
          origen: string
          publicaciones?: number
        }
        Update: {
          avisos?: Json
          dias?: number
          error?: string | null
          error_tipo?: string | null
          fin?: string | null
          id?: never
          ig_user_id?: string | null
          inicio?: string
          ok?: boolean
          origen?: string
          publicaciones?: number
        }
        Relationships: []
      }
      instagram_metricas_cuenta: {
        Row: {
          alcance: number | null
          capturado_at: string
          comentarios: number | null
          compartidos: number | null
          cuentas_interaccion: number | null
          fecha: string
          guardados: number | null
          id: number
          ig_user_id: string
          interacciones: number | null
          me_gusta: number | null
          seguidores: number | null
          toques_enlaces: number | null
          visitas_perfil: number | null
          visualizaciones: number | null
        }
        Insert: {
          alcance?: number | null
          capturado_at?: string
          comentarios?: number | null
          compartidos?: number | null
          cuentas_interaccion?: number | null
          fecha: string
          guardados?: number | null
          id?: never
          ig_user_id: string
          interacciones?: number | null
          me_gusta?: number | null
          seguidores?: number | null
          toques_enlaces?: number | null
          visitas_perfil?: number | null
          visualizaciones?: number | null
        }
        Update: {
          alcance?: number | null
          capturado_at?: string
          comentarios?: number | null
          compartidos?: number | null
          cuentas_interaccion?: number | null
          fecha?: string
          guardados?: number | null
          id?: never
          ig_user_id?: string
          interacciones?: number | null
          me_gusta?: number | null
          seguidores?: number | null
          toques_enlaces?: number | null
          visitas_perfil?: number | null
          visualizaciones?: number | null
        }
        Relationships: []
      }
      instagram_metricas_publicacion: {
        Row: {
          alcance: number | null
          capturado_at: string
          caption: string | null
          comentarios: number | null
          compartidos: number | null
          fecha_captura: string
          guardados: number | null
          id: number
          ig_user_id: string
          interacciones: number | null
          me_gusta: number | null
          media_id: string
          miniatura_url: string | null
          permalink: string | null
          pieza_id: string | null
          producto: string | null
          publicado_at: string | null
          tipo_medio: string | null
          visualizaciones: number | null
        }
        Insert: {
          alcance?: number | null
          capturado_at?: string
          caption?: string | null
          comentarios?: number | null
          compartidos?: number | null
          fecha_captura: string
          guardados?: number | null
          id?: never
          ig_user_id: string
          interacciones?: number | null
          me_gusta?: number | null
          media_id: string
          miniatura_url?: string | null
          permalink?: string | null
          pieza_id?: string | null
          producto?: string | null
          publicado_at?: string | null
          tipo_medio?: string | null
          visualizaciones?: number | null
        }
        Update: {
          alcance?: number | null
          capturado_at?: string
          caption?: string | null
          comentarios?: number | null
          compartidos?: number | null
          fecha_captura?: string
          guardados?: number | null
          id?: never
          ig_user_id?: string
          interacciones?: number | null
          me_gusta?: number | null
          media_id?: string
          miniatura_url?: string | null
          permalink?: string | null
          pieza_id?: string | null
          producto?: string | null
          publicado_at?: string | null
          tipo_medio?: string | null
          visualizaciones?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_metricas_publicacion_pieza_id_fkey"
            columns: ["pieza_id"]
            isOneToOne: false
            referencedRelation: "instagram_piezas"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_piezas: {
        Row: {
          alt_text: string | null
          caption: string | null
          contenedor_id: string | null
          created_at: string
          creado_por: string | null
          datos: Json
          drive_id: string | null
          error: string | null
          estado: string
          formato: string
          id: string
          imagen_borrada_at: string | null
          imagen_ruta: string | null
          marca: string
          media_id: string | null
          permalink: string | null
          plantilla: string
          publicada_at: string | null
          updated_at: string
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          contenedor_id?: string | null
          created_at?: string
          creado_por?: string | null
          datos?: Json
          drive_id?: string | null
          error?: string | null
          estado?: string
          formato: string
          id?: string
          imagen_borrada_at?: string | null
          imagen_ruta?: string | null
          marca: string
          media_id?: string | null
          permalink?: string | null
          plantilla: string
          publicada_at?: string | null
          updated_at?: string
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          contenedor_id?: string | null
          created_at?: string
          creado_por?: string | null
          datos?: Json
          drive_id?: string | null
          error?: string | null
          estado?: string
          formato?: string
          id?: string
          imagen_borrada_at?: string | null
          imagen_ruta?: string | null
          marca?: string
          media_id?: string | null
          permalink?: string | null
          plantilla?: string
          publicada_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      instagram_programaciones: {
        Row: {
          bloqueada_hasta: string | null
          bloqueo_id: string | null
          cancelada_at: string | null
          cancelada_por: string | null
          contenedor_id: string | null
          created_at: string
          creado_por: string | null
          estado: string
          id: string
          intentos: number
          marca: string
          media_id: string | null
          permalink: string | null
          pieza_id: string
          programada_para: string
          publicada_at: string | null
          siguiente_intento_at: string
          ultimo_error: string | null
          ultimo_intento_at: string | null
          updated_at: string
        }
        Insert: {
          bloqueada_hasta?: string | null
          bloqueo_id?: string | null
          cancelada_at?: string | null
          cancelada_por?: string | null
          contenedor_id?: string | null
          created_at?: string
          creado_por?: string | null
          estado?: string
          id?: string
          intentos?: number
          marca: string
          media_id?: string | null
          permalink?: string | null
          pieza_id: string
          programada_para: string
          publicada_at?: string | null
          siguiente_intento_at: string
          ultimo_error?: string | null
          ultimo_intento_at?: string | null
          updated_at?: string
        }
        Update: {
          bloqueada_hasta?: string | null
          bloqueo_id?: string | null
          cancelada_at?: string | null
          cancelada_por?: string | null
          contenedor_id?: string | null
          created_at?: string
          creado_por?: string | null
          estado?: string
          id?: string
          intentos?: number
          marca?: string
          media_id?: string | null
          permalink?: string | null
          pieza_id?: string
          programada_para?: string
          publicada_at?: string | null
          siguiente_intento_at?: string
          ultimo_error?: string | null
          ultimo_intento_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_programaciones_pieza_id_fkey"
            columns: ["pieza_id"]
            isOneToOne: false
            referencedRelation: "instagram_piezas"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_publicaciones_en_curso: {
        Row: {
          bloqueada_hasta: string
          bloqueo_id: string
          created_at: string
          pieza_id: string
        }
        Insert: {
          bloqueada_hasta: string
          bloqueo_id: string
          created_at?: string
          pieza_id: string
        }
        Update: {
          bloqueada_hasta?: string
          bloqueo_id?: string
          created_at?: string
          pieza_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_publicaciones_en_curso_pieza_id_fkey"
            columns: ["pieza_id"]
            isOneToOne: true
            referencedRelation: "instagram_piezas"
            referencedColumns: ["id"]
          },
        ]
      }
      items_documento: {
        Row: {
          cantidad: number | null
          descripcion: string
          documento_id: string
          embedding: string | null
          id: string
          importe_linea: number | null
          precio_unitario: number | null
        }
        Insert: {
          cantidad?: number | null
          descripcion: string
          documento_id: string
          embedding?: string | null
          id?: string
          importe_linea?: number | null
          precio_unitario?: number | null
        }
        Update: {
          cantidad?: number | null
          descripcion?: string
          documento_id?: string
          embedding?: string | null
          id?: string
          importe_linea?: number | null
          precio_unitario?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_documento_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "documentos"
            referencedColumns: ["id"]
          },
        ]
      }
      lineas_pedido: {
        Row: {
          cantidad: number
          created_at: string | null
          id: string
          nombre_producto: string
          pedido_id: string
          precio_unitario: number
          producto_id: string
          producto_tipo: string
          total_linea: number
        }
        Insert: {
          cantidad?: number
          created_at?: string | null
          id?: string
          nombre_producto: string
          pedido_id: string
          precio_unitario: number
          producto_id: string
          producto_tipo: string
          total_linea: number
        }
        Update: {
          cantidad?: number
          created_at?: string | null
          id?: string
          nombre_producto?: string
          pedido_id?: string
          precio_unitario?: number
          producto_id?: string
          producto_tipo?: string
          total_linea?: number
        }
        Relationships: [
          {
            foreignKeyName: "lineas_pedido_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_ecommerce"
            referencedColumns: ["id"]
          },
        ]
      }
      mensajes_chat: {
        Row: {
          adjuntos: Json | null
          content: string
          conversacion_id: string | null
          created_at: string | null
          id: string
          role: string
          session_id: string
        }
        Insert: {
          adjuntos?: Json | null
          content: string
          conversacion_id?: string | null
          created_at?: string | null
          id?: string
          role: string
          session_id: string
        }
        Update: {
          adjuntos?: Json | null
          content?: string
          conversacion_id?: string | null
          created_at?: string | null
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_chat_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "chat_facturas_conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_chat_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_chat_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_facturas_conversaciones"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "mensajes_chat_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["session_id"]
          },
        ]
      }
      menus_diarios: {
        Row: {
          fecha: string
          id: string
          idiom: string | null
          menu: Json
        }
        Insert: {
          fecha: string
          id?: string
          idiom?: string | null
          menu: Json
        }
        Update: {
          fecha?: string
          id?: string
          idiom?: string | null
          menu?: Json
        }
        Relationships: []
      }
      mesas: {
        Row: {
          activa: boolean | null
          alto: number | null
          ancho: number | null
          capacidad: number
          created_at: string | null
          crece_hacia: string
          espacio_id: string
          etiqueta: string | null
          forma: string
          grupo_piezas: string | null
          id: string
          is_merged: boolean | null
          nombre: string
          original_mesas: Json | null
          picos_base: number
          picos_max: number
          piezas: number | null
          piezas_max: number | null
          plazas_max: number | null
          plazas_min: number | null
          pos_x: number | null
          pos_y: number | null
          rotacion: number | null
          updated_at: string | null
        }
        Insert: {
          activa?: boolean | null
          alto?: number | null
          ancho?: number | null
          capacidad?: number
          created_at?: string | null
          crece_hacia?: string
          espacio_id: string
          etiqueta?: string | null
          forma?: string
          grupo_piezas?: string | null
          id?: string
          is_merged?: boolean | null
          nombre: string
          original_mesas?: Json | null
          picos_base?: number
          picos_max?: number
          piezas?: number | null
          piezas_max?: number | null
          plazas_max?: number | null
          plazas_min?: number | null
          pos_x?: number | null
          pos_y?: number | null
          rotacion?: number | null
          updated_at?: string | null
        }
        Update: {
          activa?: boolean | null
          alto?: number | null
          ancho?: number | null
          capacidad?: number
          created_at?: string | null
          crece_hacia?: string
          espacio_id?: string
          etiqueta?: string | null
          forma?: string
          grupo_piezas?: string | null
          id?: string
          is_merged?: boolean | null
          nombre?: string
          original_mesas?: Json | null
          picos_base?: number
          picos_max?: number
          piezas?: number | null
          piezas_max?: number | null
          plazas_max?: number | null
          plazas_min?: number | null
          pos_x?: number | null
          pos_y?: number | null
          rotacion?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mesas_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos_stock: {
        Row: {
          cantidad: number
          created_at: string | null
          id: string
          motivo: string | null
          producto_id: string
          producto_tipo: string
          referencia: string | null
          stock_anterior: number | null
          stock_nuevo: number | null
          tipo_movimiento: string
          usuario_id: string | null
        }
        Insert: {
          cantidad: number
          created_at?: string | null
          id?: string
          motivo?: string | null
          producto_id: string
          producto_tipo: string
          referencia?: string | null
          stock_anterior?: number | null
          stock_nuevo?: number | null
          tipo_movimiento: string
          usuario_id?: string | null
        }
        Update: {
          cantidad?: number
          created_at?: string | null
          id?: string
          motivo?: string | null
          producto_id?: string
          producto_tipo?: string
          referencia?: string | null
          stock_anterior?: number | null
          stock_nuevo?: number | null
          tipo_movimiento?: string
          usuario_id?: string | null
        }
        Relationships: []
      }
      n8n_chat_histories: {
        Row: {
          id: number
          message: Json
          session_id: string
        }
        Insert: {
          id?: number
          message: Json
          session_id: string
        }
        Update: {
          id?: number
          message?: Json
          session_id?: string
        }
        Relationships: []
      }
      newsletter_envios: {
        Row: {
          asunto: string
          /** 'transaccional' | 'broadcast'. Solo existe si 20261003193000_newsletter_resend_broadcasts.sql está aplicada. */
          canal: string
          created_at: string
          enviado_por: string | null
          estado: string | null
          id: string
          mensaje: string
          /** Id del Broadcast de Resend (canal = broadcast). Migración 20261003193000. */
          resend_broadcast_id: string | null
          tipo_newsletter: string | null
          total_destinatarios: number
        }
        Insert: {
          asunto: string
          canal?: string
          created_at?: string
          enviado_por?: string | null
          estado?: string | null
          id?: string
          mensaje: string
          resend_broadcast_id?: string | null
          tipo_newsletter?: string | null
          total_destinatarios?: number
        }
        Update: {
          asunto?: string
          canal?: string
          created_at?: string
          enviado_por?: string | null
          estado?: string | null
          id?: string
          mensaje?: string
          resend_broadcast_id?: string | null
          tipo_newsletter?: string | null
          total_destinatarios?: number
        }
        Relationships: []
      }
      newsletter_suscriptores: {
        Row: {
          activo: boolean
          created_at: string
          email: string
          fecha_baja: string | null
          /** Solo existe si 20261003143000_reserva_web_prueba_consentimiento.sql está aplicada. */
          fecha_consentimiento: string | null
          id: string
          nombre: string | null
          origen_alta: string | null
          /** CHECK: enlace_email | cabecera_one_click | panel_manual y, con 20261003171500 aplicada, queja_spam | rebote_permanente | suprimido_resend | resend_baja_nativa (ver src/lib/newsletter/bajas.ts). */
          origen_baja: string | null
          /** Solo existe si 20261003143000_reserva_web_prueba_consentimiento.sql está aplicada. */
          reserva_consentimiento_id: string | null
          /** Solo existe si 20261003184500 está aplicada: cuándo verificó el email (doble opt-in). */
          fecha_verificacion_email: string | null
          /** Id del contacto en Resend Marketing; lo escribe newsletter-sync-resend. Migración 20261003193000. */
          resend_contact_id: string | null
          /** Última vez que newsletter-sync-resend lo dejó cuadrado. Migración 20261003193000. */
          resend_sincronizado_at: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          email: string
          fecha_baja?: string | null
          fecha_consentimiento?: string | null
          id?: string
          nombre?: string | null
          origen_alta?: string | null
          origen_baja?: string | null
          reserva_consentimiento_id?: string | null
          fecha_verificacion_email?: string | null
          resend_contact_id?: string | null
          resend_sincronizado_at?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          email?: string
          fecha_baja?: string | null
          fecha_consentimiento?: string | null
          id?: string
          nombre?: string | null
          origen_alta?: string | null
          origen_baja?: string | null
          reserva_consentimiento_id?: string | null
          fecha_verificacion_email?: string | null
          resend_contact_id?: string | null
          resend_sincronizado_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_suscriptores_reserva_consentimiento_id_fkey"
            columns: ["reserva_consentimiento_id"]
            isOneToOne: false
            referencedRelation: "reservas"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_sincronizaciones_resend: {
        /** Una fila por pasada de newsletter-sync-resend (estado del panel + cerrojo). Solo lectura para el panel. Migración 20261003193000. */
        Row: {
          actualizados: number
          altas: number
          bajas_resend: number
          borrados: number
          contactos_ajenos: number | null
          contactos_resend: number | null
          contactos_segmento: number | null
          destinatarios: number | null
          detalle: Json | null
          ejecutada_por: string | null
          errores: number
          estado: string
          id: string
          iniciada_at: string
          mensaje_error: string | null
          origen: string
          pendientes: number
          segment_id: string | null
          terminada_at: string | null
        }
        Insert: {
          actualizados?: number
          altas?: number
          bajas_resend?: number
          borrados?: number
          contactos_ajenos?: number | null
          contactos_resend?: number | null
          contactos_segmento?: number | null
          destinatarios?: number | null
          detalle?: Json | null
          ejecutada_por?: string | null
          errores?: number
          estado?: string
          id?: string
          iniciada_at?: string
          mensaje_error?: string | null
          origen: string
          pendientes?: number
          segment_id?: string | null
          terminada_at?: string | null
        }
        Update: {
          actualizados?: number
          altas?: number
          bajas_resend?: number
          borrados?: number
          contactos_ajenos?: number | null
          contactos_resend?: number | null
          contactos_segmento?: number | null
          destinatarios?: number | null
          detalle?: Json | null
          ejecutada_por?: string | null
          errores?: number
          estado?: string
          id?: string
          iniciada_at?: string
          mensaje_error?: string | null
          origen?: string
          pendientes?: number
          segment_id?: string | null
          terminada_at?: string | null
        }
        Relationships: []
      }
      notificaciones_dashboard: {
        Row: {
          created_at: string | null
          id: string
          leida: boolean
          mensaje: string | null
          referencia_id: string | null
          referencia_tipo: string | null
          tipo: string
          titulo: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          leida?: boolean
          mensaje?: string | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          tipo: string
          titulo: string
        }
        Update: {
          created_at?: string | null
          id?: string
          leida?: boolean
          mensaje?: string | null
          referencia_id?: string | null
          referencia_tipo?: string | null
          tipo?: string
          titulo?: string
        }
        Relationships: []
      }
      novedades: {
        Row: {
          activo: boolean | null
          badge_text: string | null
          badge_text_en: string | null
          badge_text_fr: string | null
          bebida_id: string | null
          botones: Json
          bullets: string[] | null
          bullets_en: string[] | null
          bullets_fr: string[] | null
          created_at: string | null
          created_by: string | null
          descripcion: string | null
          descripcion_en: string | null
          descripcion_fr: string | null
          destacado: boolean | null
          fecha_fin: string | null
          fecha_inicio: string
          icono: string | null
          id: string
          imagen_posicion_y: number | null
          imagen_url: string | null
          menu: Json | null
          orden: number | null
          plato_id: string | null
          seccion: string | null
          tags: string[] | null
          tags_en: string[] | null
          tags_fr: string[] | null
          tipo: string
          tipo_asociacion: string | null
          titulo: string
          titulo_en: string | null
          titulo_fr: string | null
          updated_at: string | null
          vino_id: string | null
        }
        Insert: {
          activo?: boolean | null
          badge_text?: string | null
          badge_text_en?: string | null
          badge_text_fr?: string | null
          bebida_id?: string | null
          botones?: Json
          bullets?: string[] | null
          bullets_en?: string[] | null
          bullets_fr?: string[] | null
          created_at?: string | null
          created_by?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          destacado?: boolean | null
          fecha_fin?: string | null
          fecha_inicio?: string
          icono?: string | null
          id?: string
          imagen_posicion_y?: number | null
          imagen_url?: string | null
          menu?: Json | null
          orden?: number | null
          plato_id?: string | null
          seccion?: string | null
          tags?: string[] | null
          tags_en?: string[] | null
          tags_fr?: string[] | null
          tipo?: string
          tipo_asociacion?: string | null
          titulo: string
          titulo_en?: string | null
          titulo_fr?: string | null
          updated_at?: string | null
          vino_id?: string | null
        }
        Update: {
          activo?: boolean | null
          badge_text?: string | null
          badge_text_en?: string | null
          badge_text_fr?: string | null
          bebida_id?: string | null
          botones?: Json
          bullets?: string[] | null
          bullets_en?: string[] | null
          bullets_fr?: string[] | null
          created_at?: string | null
          created_by?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          destacado?: boolean | null
          fecha_fin?: string | null
          fecha_inicio?: string
          icono?: string | null
          id?: string
          imagen_posicion_y?: number | null
          imagen_url?: string | null
          menu?: Json | null
          orden?: number | null
          plato_id?: string | null
          seccion?: string | null
          tags?: string[] | null
          tags_en?: string[] | null
          tags_fr?: string[] | null
          tipo?: string
          tipo_asociacion?: string | null
          titulo?: string
          titulo_en?: string | null
          titulo_fr?: string | null
          updated_at?: string | null
          vino_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "novedades_bebida_id_fkey"
            columns: ["bebida_id"]
            isOneToOne: false
            referencedRelation: "Bebidas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "novedades_plato_id_fkey"
            columns: ["plato_id"]
            isOneToOne: false
            referencedRelation: "Platos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "novedades_vino_id_fkey"
            columns: ["vino_id"]
            isOneToOne: false
            referencedRelation: "Vinos"
            referencedColumns: ["id"]
          },
        ]
      }
      ocupacion_diaria: {
        Row: {
          comensales_confirmados: number | null
          created_at: string | null
          dia_semana: number | null
          fecha: string
          hora: string | null
          id: string
          reservas_canceladas: number | null
          reservas_confirmadas: number | null
          reservas_no_show: number | null
          total_comensales: number
          total_reservas: number
          turno: string | null
          updated_at: string | null
        }
        Insert: {
          comensales_confirmados?: number | null
          created_at?: string | null
          dia_semana?: number | null
          fecha: string
          hora?: string | null
          id?: string
          reservas_canceladas?: number | null
          reservas_confirmadas?: number | null
          reservas_no_show?: number | null
          total_comensales?: number
          total_reservas?: number
          turno?: string | null
          updated_at?: string | null
        }
        Update: {
          comensales_confirmados?: number | null
          created_at?: string | null
          dia_semana?: number | null
          fecha?: string
          hora?: string | null
          id?: string
          reservas_canceladas?: number | null
          reservas_confirmadas?: number | null
          reservas_no_show?: number | null
          total_comensales?: number
          total_reservas?: number
          turno?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ocr_trabajo_paginas: {
        Row: {
          bytes: number
          coste_usd: number | null
          created_at: string
          despachada_at: string | null
          duracion_ms: number | null
          error: string | null
          estado: string
          filas_contadas: number | null
          filas_extraidas: number | null
          franja: number | null
          franjas_pagina: number | null
          id: number
          intentos: number
          lease_hasta: string | null
          mime: string
          motivo_relectura: Json | null
          motivos: Json | null
          no_antes_de: string
          numero: number
          pagina_doc: number
          pieza: string
          recuento: Json | null
          relecturas: number
          resultado: Json | null
          storage_path: string
          tokens_entrada: number | null
          tokens_salida: number | null
          trabajo_id: string
          updated_at: string
          verificacion_pie: Json | null
        }
        Insert: {
          bytes: number
          coste_usd?: number | null
          created_at?: string
          despachada_at?: string | null
          duracion_ms?: number | null
          error?: string | null
          estado?: string
          filas_contadas?: number | null
          filas_extraidas?: number | null
          franja?: number | null
          franjas_pagina?: number | null
          id?: number
          intentos?: number
          lease_hasta?: string | null
          mime: string
          motivo_relectura?: Json | null
          motivos?: Json | null
          no_antes_de?: string
          numero: number
          pagina_doc?: number
          pieza?: string
          recuento?: Json | null
          relecturas?: number
          resultado?: Json | null
          storage_path: string
          tokens_entrada?: number | null
          tokens_salida?: number | null
          trabajo_id: string
          updated_at?: string
          verificacion_pie?: Json | null
        }
        Update: {
          bytes?: number
          coste_usd?: number | null
          created_at?: string
          despachada_at?: string | null
          duracion_ms?: number | null
          error?: string | null
          estado?: string
          filas_contadas?: number | null
          filas_extraidas?: number | null
          franja?: number | null
          franjas_pagina?: number | null
          id?: number
          intentos?: number
          lease_hasta?: string | null
          mime?: string
          motivo_relectura?: Json | null
          motivos?: Json | null
          no_antes_de?: string
          numero?: number
          pagina_doc?: number
          pieza?: string
          recuento?: Json | null
          relecturas?: number
          resultado?: Json | null
          storage_path?: string
          tokens_entrada?: number | null
          tokens_salida?: number | null
          trabajo_id?: string
          updated_at?: string
          verificacion_pie?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ocr_trabajo_paginas_trabajo_id_fkey"
            columns: ["trabajo_id"]
            isOneToOne: false
            referencedRelation: "ocr_trabajos"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_trabajos: {
        Row: {
          consolidar_despachado_at: string | null
          contexto_p1: Json | null
          coste_usd: number
          creado_por: string
          created_at: string
          documento_pendiente: Json | null
          error: string | null
          estado: string
          factura_id: number | null
          id: string
          intentos_consolidacion: number
          lease_hasta: string | null
          limite_at: string
          modelo: string | null
          nombre_original: string
          num_paginas: number
          origen: string
          original_mime: string | null
          original_path: string | null
          paginas_documento: number
          resultado: Json | null
          ronda_relectura: number
          terminado_at: string | null
          updated_at: string
        }
        Insert: {
          consolidar_despachado_at?: string | null
          contexto_p1?: Json | null
          coste_usd?: number
          creado_por: string
          created_at?: string
          documento_pendiente?: Json | null
          error?: string | null
          estado?: string
          factura_id?: number | null
          id: string
          intentos_consolidacion?: number
          lease_hasta?: string | null
          limite_at?: string
          modelo?: string | null
          nombre_original: string
          num_paginas: number
          origen: string
          original_mime?: string | null
          original_path?: string | null
          paginas_documento?: number
          resultado?: Json | null
          ronda_relectura?: number
          terminado_at?: string | null
          updated_at?: string
        }
        Update: {
          consolidar_despachado_at?: string | null
          contexto_p1?: Json | null
          coste_usd?: number
          creado_por?: string
          created_at?: string
          documento_pendiente?: Json | null
          error?: string | null
          estado?: string
          factura_id?: number | null
          id?: string
          intentos_consolidacion?: number
          lease_hasta?: string | null
          limite_at?: string
          modelo?: string | null
          nombre_original?: string
          num_paginas?: number
          origen?: string
          original_mime?: string | null
          original_path?: string | null
          paginas_documento?: number
          resultado?: Json | null
          ronda_relectura?: number
          terminado_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocr_trabajos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_ecommerce: {
        Row: {
          caja: string | null
          ciudad_envio: string | null
          codigo_postal_envio: string | null
          created_at: string | null
          descuento: number | null
          direccion_envio: string | null
          email: string | null
          estado: string | null
          fecha_entrega: string | null
          fecha_envio: string | null
          fecha_pago: string | null
          gastos_envio: number | null
          id: string
          iva: number | null
          metodo_pago: string | null
          nombre_completo: string | null
          notas_cliente: string | null
          notas_internas: string | null
          numero_pedido: string
          numero_seguimiento: string | null
          numero_ticket: string | null
          pagado: boolean | null
          pais_envio: string | null
          referencia_pago: string | null
          subtotal: number
          telefono: string | null
          tipo_venta: string | null
          total: number
          transportista: string | null
          updated_at: string | null
          user_id: string | null
          vendedor_id: string | null
        }
        Insert: {
          caja?: string | null
          ciudad_envio?: string | null
          codigo_postal_envio?: string | null
          created_at?: string | null
          descuento?: number | null
          direccion_envio?: string | null
          email?: string | null
          estado?: string | null
          fecha_entrega?: string | null
          fecha_envio?: string | null
          fecha_pago?: string | null
          gastos_envio?: number | null
          id?: string
          iva?: number | null
          metodo_pago?: string | null
          nombre_completo?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          numero_pedido: string
          numero_seguimiento?: string | null
          numero_ticket?: string | null
          pagado?: boolean | null
          pais_envio?: string | null
          referencia_pago?: string | null
          subtotal?: number
          telefono?: string | null
          tipo_venta?: string | null
          total?: number
          transportista?: string | null
          updated_at?: string | null
          user_id?: string | null
          vendedor_id?: string | null
        }
        Update: {
          caja?: string | null
          ciudad_envio?: string | null
          codigo_postal_envio?: string | null
          created_at?: string | null
          descuento?: number | null
          direccion_envio?: string | null
          email?: string | null
          estado?: string | null
          fecha_entrega?: string | null
          fecha_envio?: string | null
          fecha_pago?: string | null
          gastos_envio?: number | null
          id?: string
          iva?: number | null
          metodo_pago?: string | null
          nombre_completo?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          numero_pedido?: string
          numero_seguimiento?: string | null
          numero_ticket?: string | null
          pagado?: boolean | null
          pais_envio?: string | null
          referencia_pago?: string | null
          subtotal?: number
          telefono?: string | null
          tipo_venta?: string | null
          total?: number
          transportista?: string | null
          updated_at?: string | null
          user_id?: string | null
          vendedor_id?: string | null
        }
        Relationships: []
      }
      peso_paginas: {
        Row: {
          actualizado_en: string
          bytes_por_visita: number
          nota: string | null
          proyecto: string
          ruta: string
        }
        Insert: {
          actualizado_en?: string
          bytes_por_visita: number
          nota?: string | null
          proyecto: string
          ruta?: string
        }
        Update: {
          actualizado_en?: string
          bytes_por_visita?: number
          nota?: string | null
          proyecto?: string
          ruta?: string
        }
        Relationships: []
      }
      phone_system_config: {
        Row: {
          address: string | null
          bot_greeting: string | null
          bot_responses: Json
          created_at: string | null
          forward_phone: string | null
          id: string
          max_party_size: number | null
          mode: string
          opening_hours: string | null
          phone_number: string | null
          restaurant_id: string
          restaurant_name: string
          schedule: Json | null
          schedule_enabled: boolean | null
          updated_at: string | null
          vapi_assistant_id: string | null
          vapi_phone_number_id: string | null
          voice_id: string | null
          webhook_url: string | null
        }
        Insert: {
          address?: string | null
          bot_greeting?: string | null
          bot_responses?: Json
          created_at?: string | null
          forward_phone?: string | null
          id?: string
          max_party_size?: number | null
          mode?: string
          opening_hours?: string | null
          phone_number?: string | null
          restaurant_id: string
          restaurant_name?: string
          schedule?: Json | null
          schedule_enabled?: boolean | null
          updated_at?: string | null
          vapi_assistant_id?: string | null
          vapi_phone_number_id?: string | null
          voice_id?: string | null
          webhook_url?: string | null
        }
        Update: {
          address?: string | null
          bot_greeting?: string | null
          bot_responses?: Json
          created_at?: string | null
          forward_phone?: string | null
          id?: string
          max_party_size?: number | null
          mode?: string
          opening_hours?: string | null
          phone_number?: string | null
          restaurant_id?: string
          restaurant_name?: string
          schedule?: Json | null
          schedule_enabled?: boolean | null
          updated_at?: string | null
          vapi_assistant_id?: string | null
          vapi_phone_number_id?: string | null
          voice_id?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      planos_espacio: {
        Row: {
          alto: number | null
          alto_metros: number | null
          ancho: number | null
          ancho_metros: number | null
          configuracion: Json | null
          created_at: string | null
          espacio_id: string
          id: string
          metros_cuadrados: number | null
          pixels_per_meter: number | null
          updated_at: string | null
        }
        Insert: {
          alto?: number | null
          alto_metros?: number | null
          ancho?: number | null
          ancho_metros?: number | null
          configuracion?: Json | null
          created_at?: string | null
          espacio_id: string
          id?: string
          metros_cuadrados?: number | null
          pixels_per_meter?: number | null
          updated_at?: string | null
        }
        Update: {
          alto?: number | null
          alto_metros?: number | null
          ancho?: number | null
          ancho_metros?: number | null
          configuracion?: Json | null
          created_at?: string | null
          espacio_id?: string
          id?: string
          metros_cuadrados?: number | null
          pixels_per_meter?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planos_espacio_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: true
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
        ]
      }
      Platos: {
        Row: {
          sin_gluten_disponible: boolean
          activado: boolean | null
          alergenos_en: string | null
          alergenos_fr: string | null
          alergenos_inferidos: Json | null
          alergenos_notas: string | null
          alergenos_oficiales: Json | null
          categoria: string | null
          categoria_en: string | null
          categoria_fr: string | null
          created_at: string | null
          descripcion: string | null
          descripcion_en: string | null
          descripcion_fr: string | null
          expanded: boolean | null
          featured: boolean | null
          id: string
          imagen_posicion_y: number | null
          imagen_url: string | null
          ingredientes: string | null
          nombre: string | null
          nombre_en: string | null
          nombre_fr: string | null
          orden: string | null
          precio_eur: number | null
          restaurante: boolean | null
          touza: boolean | null
          traducciones: Json | null
          unidad: string | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          sin_gluten_disponible?: boolean
          activado?: boolean | null
          alergenos_en?: string | null
          alergenos_fr?: string | null
          alergenos_inferidos?: Json | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          expanded?: boolean | null
          featured?: boolean | null
          id: string
          imagen_posicion_y?: number | null
          imagen_url?: string | null
          ingredientes?: string | null
          nombre?: string | null
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: string | null
          precio_eur?: number | null
          restaurante?: boolean | null
          touza?: boolean | null
          traducciones?: Json | null
          unidad?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          sin_gluten_disponible?: boolean
          activado?: boolean | null
          alergenos_en?: string | null
          alergenos_fr?: string | null
          alergenos_inferidos?: Json | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          descripcion?: string | null
          descripcion_en?: string | null
          descripcion_fr?: string | null
          expanded?: boolean | null
          featured?: boolean | null
          id?: string
          imagen_posicion_y?: number | null
          imagen_url?: string | null
          ingredientes?: string | null
          nombre?: string | null
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: string | null
          precio_eur?: number | null
          restaurante?: boolean | null
          touza?: boolean | null
          traducciones?: Json | null
          unidad?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      productos_alias: {
        Row: {
          created_at: string
          origen: string
          producto_id: number
          texto_normalizado: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          origen?: string
          producto_id: number
          texto_normalizado: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          origen?: string
          producto_id?: number
          texto_normalizado?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "productos_alias_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos_catalogo"
            referencedColumns: ["id"]
          },
        ]
      }
      productos_catalogo: {
        Row: {
          categoria_id: number | null
          contenido_cantidad: number | null
          contenido_unidad: string | null
          created_at: string
          creado_por: string | null
          id: number
          nombre: string
          nombre_normalizado: string | null
          origen: string
          unidad_habitual: string | null
          updated_at: string
        }
        Insert: {
          categoria_id?: number | null
          contenido_cantidad?: number | null
          contenido_unidad?: string | null
          created_at?: string
          creado_por?: string | null
          id?: never
          nombre: string
          nombre_normalizado?: never
          origen?: string
          unidad_habitual?: string | null
          updated_at?: string
        }
        Update: {
          categoria_id?: number | null
          contenido_cantidad?: number | null
          contenido_unidad?: string | null
          created_at?: string
          creado_por?: string | null
          id?: never
          nombre?: string
          nombre_normalizado?: never
          origen?: string
          unidad_habitual?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "productos_catalogo_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_producto"
            referencedColumns: ["id"]
          },
        ]
      }
      productos_factura: {
        Row: {
          albaran_ref: string | null
          bultos: number | null
          cantidad: number
          contenido_cantidad: number | null
          contenido_origen: string | null
          contenido_unidad: string | null
          created_at: string | null
          descuento_pct: number | null
          embedding: string | null
          factura_id: number
          id: number
          importe_bruto: number | null
          importe_bruto_estimado: boolean
          iva_pct: number | null
          nombre: string
          nombre_normalizado: string | null
          orden: number | null
          pagina: number | null
          precio_unitario: number | null
          producto_id: number | null
          total: number | null
          unidad: string | null
        }
        Insert: {
          albaran_ref?: string | null
          bultos?: number | null
          cantidad?: number
          contenido_cantidad?: number | null
          contenido_origen?: string | null
          contenido_unidad?: string | null
          created_at?: string | null
          descuento_pct?: number | null
          embedding?: string | null
          factura_id: number
          id?: number
          importe_bruto?: number | null
          importe_bruto_estimado?: boolean
          iva_pct?: number | null
          nombre: string
          nombre_normalizado?: string | null
          orden?: number | null
          pagina?: number | null
          precio_unitario?: number | null
          producto_id?: number | null
          total?: number | null
          unidad?: string | null
        }
        Update: {
          albaran_ref?: string | null
          bultos?: number | null
          cantidad?: number
          contenido_cantidad?: number | null
          contenido_origen?: string | null
          contenido_unidad?: string | null
          created_at?: string | null
          descuento_pct?: number | null
          embedding?: string | null
          factura_id?: number
          id?: number
          importe_bruto?: number | null
          importe_bruto_estimado?: boolean
          iva_pct?: number | null
          nombre?: string
          nombre_normalizado?: string | null
          orden?: number | null
          pagina?: number | null
          precio_unitario?: number | null
          producto_id?: number | null
          total?: number | null
          unidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_factura_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos_catalogo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_factura_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_factura_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "vista_ultimos_documentos"
            referencedColumns: ["id"]
          },
        ]
      }
      proveedores: {
        Row: {
          activo: boolean | null
          categoria: string | null
          cif: string | null
          cif_normalizado: string | null
          created_at: string | null
          direccion: string | null
          email: string | null
          id: number
          nombre: string
          nombre_comercial: string | null
          nombre_normalizado: string | null
          notas: string | null
          origen: string | null
          telefono: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          categoria?: string | null
          cif?: string | null
          created_at?: string | null
          direccion?: string | null
          email?: string | null
          id?: number
          nombre: string
          nombre_comercial?: string | null
          notas?: string | null
          origen?: string | null
          telefono?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          categoria?: string | null
          cif?: string | null
          created_at?: string | null
          direccion?: string | null
          email?: string | null
          id?: number
          nombre?: string
          nombre_comercial?: string | null
          notas?: string | null
          origen?: string | null
          telefono?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      proveedores_alias: {
        Row: {
          alias_normalizado: string | null
          cif_normalizado: string | null
          created_at: string
          id: number
          origen: string
          proveedor_id: number
          texto_original: string | null
        }
        Insert: {
          alias_normalizado?: string | null
          cif_normalizado?: string | null
          created_at?: string
          id?: never
          origen?: string
          proveedor_id: number
          texto_original?: string | null
        }
        Update: {
          alias_normalizado?: string | null
          cif_normalizado?: string | null
          created_at?: string
          id?: never
          origen?: string
          proveedor_id?: number
          texto_original?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_alias_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      publicaciones_redes: {
        Row: {
          contenido: string
          created_at: string | null
          error_mensaje: string | null
          estado: string | null
          fecha_programada: string | null
          fecha_publicacion: string | null
          id: string
          imagen_url: string | null
          post_id_facebook: string | null
          post_id_instagram: string | null
          red_social: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          contenido: string
          created_at?: string | null
          error_mensaje?: string | null
          estado?: string | null
          fecha_programada?: string | null
          fecha_publicacion?: string | null
          id?: string
          imagen_url?: string | null
          post_id_facebook?: string | null
          post_id_instagram?: string | null
          red_social: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          contenido?: string
          created_at?: string | null
          error_mensaje?: string | null
          estado?: string | null
          fecha_programada?: string | null
          fecha_publicacion?: string | null
          id?: string
          imagen_url?: string | null
          post_id_facebook?: string | null
          post_id_instagram?: string | null
          red_social?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      rate_limit_log: {
        Row: {
          created_at: string
          id: string
          identifier: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier?: string
        }
        Relationships: []
      }
      registro_horas: {
        Row: {
          created_at: string | null
          fecha: string
          hora_entrada: string
          hora_salida: string | null
          horas_trabajadas: number | null
          id: string
          notas: string | null
          trabajador_id: string
          turno_id: string | null
        }
        Insert: {
          created_at?: string | null
          fecha: string
          hora_entrada: string
          hora_salida?: string | null
          horas_trabajadas?: number | null
          id?: string
          notas?: string | null
          trabajador_id: string
          turno_id?: string | null
        }
        Update: {
          created_at?: string | null
          fecha?: string
          hora_entrada?: string
          hora_salida?: string | null
          horas_trabajadas?: number | null
          id?: string
          notas?: string | null
          trabajador_id?: string
          turno_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registro_horas_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_horas_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_horas_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "vista_turnos_con_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      resenas: {
        Row: {
          comentario: string | null
          created_at: string | null
          email: string | null
          estado: string | null
          fecha: string
          fecha_respuesta: string | null
          fuente: string | null
          google_rating: number | null
          google_review_id: string | null
          id: string
          nombre_cliente: string
          respuesta: string | null
          updated_at: string | null
          valoracion: number
        }
        Insert: {
          comentario?: string | null
          created_at?: string | null
          email?: string | null
          estado?: string | null
          fecha?: string
          fecha_respuesta?: string | null
          fuente?: string | null
          google_rating?: number | null
          google_review_id?: string | null
          id?: string
          nombre_cliente: string
          respuesta?: string | null
          updated_at?: string | null
          valoracion: number
        }
        Update: {
          comentario?: string | null
          created_at?: string | null
          email?: string | null
          estado?: string | null
          fecha?: string
          fecha_respuesta?: string | null
          fuente?: string | null
          google_rating?: number | null
          google_review_id?: string | null
          id?: string
          nombre_cliente?: string
          respuesta?: string | null
          updated_at?: string | null
          valoracion?: number
        }
        Relationships: []
      }
      reservas: {
        Row: {
          canal: string | null
          /** Solo existe si 20261003143000_reserva_web_prueba_consentimiento.sql está aplicada. */
          condiciones_aceptadas_at: string | null
          consentimiento_newsletter: boolean
          created_at: string | null
          email: string | null
          en_blacklist: boolean | null
          espacio_id: string | null
          estado: string
          fecha: string
          hora: string
          id: string
          importante: boolean
          /** «Menú del día» (martes a jueves, comida): marca de la reserva. Solo existe si la migración de servicios_bloqueados/menu_del_dia está aplicada. */
          menu_del_dia: boolean
          /** «Menú cerrado» (de grupo; 20261122190000_reservas_menu_cerrado). NO es `menu_del_dia`. */
          menu_cerrado: boolean
          /** Precio del menú cerrado en euros (20261122190000): numeric(6,2) >= 0, NULL = sin precio. */
          menu_precio: number | null
          /** «Fijar mesa» (20261107120000_reservas_mesa_fijada.sql): los recálculos no la mueven. */
          mesa_fijada: boolean
          nombre: string | null
          notas_cliente: string | null
          numero_comensales: number
          telefono: string | null
          updated_at: string | null
          solicitud_id: string | null
          /** Solo existe si 20260926150000_modo_servicio_config_y_salida.sql está aplicada. */
          salida_at: string | null
          /** Doble opt-in del newsletter: solo existen si 20261003184500_newsletter_doble_optin_y_email_normalizado.sql está aplicada. Las escribe la BD/Edge Functions; el panel no puede cambiarlas. */
          email_verificado_at: string | null
          consentimiento_newsletter_at: string | null
          /** «Cómo se hizo la reserva» (20261122121500_reservas_origen.sql). Solo reservas web; la escribe reservas-web. Ver src/lib/reservas/origenReserva.ts. */
          origen: Json | null
          /** «¿Dentro o fuera?» (20261122200000_reservas_zona_preferida): 'dentro' | 'fuera' | null (no se dijo). Ver src/lib/reservas/zonaPreferida.ts. */
          zona_preferida: string | null
        }
        Insert: {
          canal?: string | null
          condiciones_aceptadas_at?: string | null
          consentimiento_newsletter?: boolean
          created_at?: string | null
          email?: string | null
          en_blacklist?: boolean | null
          espacio_id?: string | null
          estado?: string
          fecha: string
          hora: string
          id?: string
          importante?: boolean
          menu_del_dia?: boolean
          menu_cerrado?: boolean
          menu_precio?: number | null
          mesa_fijada?: boolean
          nombre?: string | null
          notas_cliente?: string | null
          numero_comensales: number
          telefono?: string | null
          updated_at?: string | null
          solicitud_id?: string | null
          salida_at?: string | null
          email_verificado_at?: string | null
          consentimiento_newsletter_at?: string | null
          origen?: Json | null
          zona_preferida?: string | null
        }
        Update: {
          canal?: string | null
          condiciones_aceptadas_at?: string | null
          consentimiento_newsletter?: boolean
          created_at?: string | null
          email?: string | null
          en_blacklist?: boolean | null
          espacio_id?: string | null
          estado?: string
          fecha?: string
          hora?: string
          id?: string
          importante?: boolean
          menu_del_dia?: boolean
          menu_cerrado?: boolean
          menu_precio?: number | null
          mesa_fijada?: boolean
          nombre?: string | null
          notas_cliente?: string | null
          numero_comensales?: number
          telefono?: string | null
          updated_at?: string | null
          solicitud_id?: string | null
          salida_at?: string | null
          email_verificado_at?: string | null
          consentimiento_newsletter_at?: string | null
          origen?: Json | null
          zona_preferida?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
        ]
      }
      scope_prices: {
        Row: {
          currency: string
          scope_name: string
          unit_price_cents: number
        }
        Insert: {
          currency?: string
          scope_name: string
          unit_price_cents: number
        }
        Update: {
          currency?: string
          scope_name?: string
          unit_price_cents?: number
        }
        Relationships: []
      }
      security_log: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          type: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          type: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          type?: string
        }
        Relationships: []
      }
      sell_users: {
        Row: {
          acepta_marketing: boolean | null
          apellidos: string | null
          avatar_url: string | null
          ciudad: string | null
          codigo_postal: string | null
          created_at: string | null
          direccion: string | null
          fecha_nacimiento: string | null
          id: string
          nombre: string | null
          pais: string | null
          telefono: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          acepta_marketing?: boolean | null
          apellidos?: string | null
          avatar_url?: string | null
          ciudad?: string | null
          codigo_postal?: string | null
          created_at?: string | null
          direccion?: string | null
          fecha_nacimiento?: string | null
          id?: string
          nombre?: string | null
          pais?: string | null
          telefono?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          acepta_marketing?: boolean | null
          apellidos?: string | null
          avatar_url?: string | null
          ciudad?: string | null
          codigo_postal?: string | null
          created_at?: string | null
          direccion?: string | null
          fecha_nacimiento?: string | null
          id?: string
          nombre?: string | null
          pais?: string | null
          telefono?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      // Super Admin › Servicios (migraciones 20261103120000 y 20261103160000).
      servicios_bloqueados: {
        Row: {
          created_at: string
          created_by: string | null
          fecha: string
          motivo: string | null
          turno: "comida" | "cena"
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fecha: string
          motivo?: string | null
          turno: "comida" | "cena"
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fecha?: string
          motivo?: string | null
          turno?: "comida" | "cena"
        }
        Relationships: []
      }
      servicios_config: {
        Row: {
          actualizado_en: string
          actualizado_por: string | null
          eur_por_usd: number
          id: boolean
        }
        Insert: {
          actualizado_en?: string
          actualizado_por?: string | null
          eur_por_usd?: number
          id?: boolean
        }
        Update: {
          actualizado_en?: string
          actualizado_por?: string | null
          eur_por_usd?: number
          id?: boolean
        }
        Relationships: []
      }
      servicios_contratados: {
        Row: {
          activo: boolean
          actualizado_en: string
          actualizado_por: string | null
          categoria: string
          ciclo: string
          cuenta: string | null
          fuente_precio: string | null
          limites: Json
          moneda: string
          nombre: string
          notas: string | null
          orden: number
          panel_url: string | null
          plan: string | null
          por_confirmar: boolean
          precio_anual: number | null
          precio_mensual: number | null
          proveedor: string
          renovacion: string | null
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          actualizado_por?: string | null
          categoria?: string
          ciclo?: string
          cuenta?: string | null
          fuente_precio?: string | null
          limites?: Json
          moneda?: string
          nombre: string
          notas?: string | null
          orden?: number
          panel_url?: string | null
          plan?: string | null
          por_confirmar?: boolean
          precio_anual?: number | null
          precio_mensual?: number | null
          proveedor: string
          renovacion?: string | null
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          actualizado_por?: string | null
          categoria?: string
          ciclo?: string
          cuenta?: string | null
          fuente_precio?: string | null
          limites?: Json
          moneda?: string
          nombre?: string
          notas?: string | null
          orden?: number
          panel_url?: string | null
          plan?: string | null
          por_confirmar?: boolean
          precio_anual?: number | null
          precio_mensual?: number | null
          proveedor?: string
          renovacion?: string | null
        }
        Relationships: []
      }
      servicios_uso: {
        Row: {
          coste_variable: Json | null
          detalles: Json
          error: string | null
          id: string
          metricas: Json
          proveedor: string
          tomado_en: string
        }
        Insert: {
          coste_variable?: Json | null
          detalles?: Json
          error?: string | null
          id?: string
          metricas?: Json
          proveedor: string
          tomado_en?: string
        }
        Update: {
          coste_variable?: Json | null
          detalles?: Json
          error?: string | null
          id?: string
          metricas?: Json
          proveedor?: string
          tomado_en?: string
        }
        Relationships: []
      }
      solicitudes_pendientes: {
        Row: {
          created_at: string | null
          descripcion_rechazo: string | null
          email: string | null
          estado: string
          fecha_solicitada: string | null
          hora_solicitada: string | null
          id: string
          marca: string
          motivo_rechazo: string
          nombre: string | null
          notas_cliente: string | null
          notas_internas: string | null
          numero_comensales: number | null
          telefono: string | null
          updated_at: string | null
          espacio_propuesto_id: string | null
          propuesta_enviada_at: string | null
          propuesta_error: string | null
          propuesta_estado: string
          propuesta_respondida_at: string | null
          propuesta_respuesta_via: string | null
          reserva_id: string | null
          /** Solo existen si 20261003184500 está aplicada (casillas del formulario web; las escribe reservas-web). */
          consentimiento_newsletter: boolean
          condiciones_aceptadas_at: string | null
        }
        Insert: {
          created_at?: string | null
          descripcion_rechazo?: string | null
          email?: string | null
          estado?: string
          fecha_solicitada?: string | null
          hora_solicitada?: string | null
          id?: string
          marca?: string
          motivo_rechazo: string
          nombre?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          numero_comensales?: number | null
          telefono?: string | null
          updated_at?: string | null
          espacio_propuesto_id?: string | null
          propuesta_enviada_at?: string | null
          propuesta_error?: string | null
          propuesta_estado?: string
          propuesta_respondida_at?: string | null
          propuesta_respuesta_via?: string | null
          reserva_id?: string | null
          consentimiento_newsletter?: boolean
          condiciones_aceptadas_at?: string | null
        }
        Update: {
          created_at?: string | null
          descripcion_rechazo?: string | null
          email?: string | null
          estado?: string
          fecha_solicitada?: string | null
          hora_solicitada?: string | null
          id?: string
          marca?: string
          motivo_rechazo?: string
          nombre?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          numero_comensales?: number | null
          telefono?: string | null
          updated_at?: string | null
          espacio_propuesto_id?: string | null
          propuesta_enviada_at?: string | null
          propuesta_error?: string | null
          propuesta_estado?: string
          propuesta_respondida_at?: string | null
          propuesta_respuesta_via?: string | null
          reserva_id?: string | null
          consentimiento_newsletter?: boolean
          condiciones_aceptadas_at?: string | null
        }
        Relationships: []
      }
      tapas: {
        Row: {
          fecha: string
          id: string
          idiom: string | null
          tapas: Json
        }
        Insert: {
          fecha: string
          id?: string
          idiom?: string | null
          tapas: Json
        }
        Update: {
          fecha?: string
          id?: string
          idiom?: string | null
          tapas?: Json
        }
        Relationships: []
      }
      trabajadores: {
        Row: {
          activo: boolean | null
          apellidos: string
          created_at: string | null
          email: string | null
          fecha_contratacion: string
          foto_url: string | null
          id: string
          nombre: string
          notas: string | null
          puesto: Database["public"]["Enums"]["puesto_trabajo"]
          salario_hora: number | null
          telefono: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          apellidos: string
          created_at?: string | null
          email?: string | null
          fecha_contratacion?: string
          foto_url?: string | null
          id?: string
          nombre: string
          notas?: string | null
          puesto: Database["public"]["Enums"]["puesto_trabajo"]
          salario_hora?: number | null
          telefono: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          apellidos?: string
          created_at?: string | null
          email?: string | null
          fecha_contratacion?: string
          foto_url?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          puesto?: Database["public"]["Enums"]["puesto_trabajo"]
          salario_hora?: number | null
          telefono?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      trafico_web_desglose: {
        Row: {
          dimension: string
          fecha: string
          proyecto: string
          sincronizado_en: string
          valor: string
          visitantes: number | null
          visitas: number
        }
        Insert: {
          dimension: string
          fecha: string
          proyecto: string
          sincronizado_en?: string
          valor: string
          visitantes?: number | null
          visitas: number
        }
        Update: {
          dimension?: string
          fecha?: string
          proyecto?: string
          sincronizado_en?: string
          valor?: string
          visitantes?: number | null
          visitas?: number
        }
        Relationships: []
      }
      trafico_web_diario: {
        Row: {
          fecha: string
          proyecto: string
          ruta: string
          sincronizado_en: string
          visitantes: number | null
          visitas: number
        }
        Insert: {
          fecha: string
          proyecto: string
          ruta?: string
          sincronizado_en?: string
          visitantes?: number | null
          visitas: number
        }
        Update: {
          fecha?: string
          proyecto?: string
          ruta?: string
          sincronizado_en?: string
          visitantes?: number | null
          visitas?: number
        }
        Relationships: []
      }
      trafico_web_sync_estado: {
        Row: {
          dias_ultimo_sync: number | null
          fallos_consecutivos: number
          proyecto: string
          ultimo_error: string | null
          ultimo_intento_en: string | null
          ultimo_ok_en: string | null
        }
        Insert: {
          dias_ultimo_sync?: number | null
          fallos_consecutivos?: number
          proyecto: string
          ultimo_error?: string | null
          ultimo_intento_en?: string | null
          ultimo_ok_en?: string | null
        }
        Update: {
          dias_ultimo_sync?: number | null
          fallos_consecutivos?: number
          proyecto?: string
          ultimo_error?: string | null
          ultimo_intento_en?: string | null
          ultimo_ok_en?: string | null
        }
        Relationships: []
      }
      turnos: {
        Row: {
          created_at: string | null
          estado: Database["public"]["Enums"]["estado_turno"] | null
          fecha: string
          hora_fin: string
          hora_inicio: string
          id: string
          notas: string | null
          trabajador_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          estado?: Database["public"]["Enums"]["estado_turno"] | null
          fecha: string
          hora_fin: string
          hora_inicio: string
          id?: string
          notas?: string | null
          trabajador_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          estado?: Database["public"]["Enums"]["estado_turno"] | null
          fecha?: string
          hora_fin?: string
          hora_inicio?: string
          id?: string
          notas?: string | null
          trabajador_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "turnos_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          client_id: string
          id: number
          installation_id: string | null
          metadata: Json | null
          occurred_at: string
          scope_name: string
          status: string
          unit_price_cents: number
          workflow_name: string | null
        }
        Insert: {
          client_id: string
          id?: number
          installation_id?: string | null
          metadata?: Json | null
          occurred_at?: string
          scope_name: string
          status?: string
          unit_price_cents: number
          workflow_name?: string | null
        }
        Update: {
          client_id?: string
          id?: number
          installation_id?: string | null
          metadata?: Json | null
          occurred_at?: string
          scope_name?: string
          status?: string
          unit_price_cents?: number
          workflow_name?: string | null
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          can_edit: boolean | null
          can_view: boolean | null
          created_at: string | null
          id: string
          section_key: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          can_edit?: boolean | null
          can_view?: boolean | null
          created_at?: string | null
          id?: string
          section_key: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          can_edit?: boolean | null
          can_view?: boolean | null
          created_at?: string | null
          id?: string
          section_key?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_role_presets: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at: string
          created_by: string | null
          id: string
          name: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          base_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          accion: string
          actor_email: string | null
          actor_label: string
          actor_origin: string
          actor_user_id: string | null
          created_at: string
          detalles: Json | null
          id: string
          registro_id: string | null
          tabla: string | null
          device_id: string | null
          ip_address: string | null
          request_id: string | null
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          accion: string
          actor_email?: string | null
          actor_label?: string
          actor_origin?: string
          actor_user_id?: string | null
          created_at?: string
          detalles?: Json | null
          id?: string
          registro_id?: string | null
          tabla?: string | null
          device_id?: string | null
          ip_address?: string | null
          request_id?: string | null
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          accion?: string
          actor_email?: string | null
          actor_label?: string
          actor_origin?: string
          actor_user_id?: string | null
          created_at?: string
          detalles?: Json | null
          id?: string
          registro_id?: string | null
          tabla?: string | null
          device_id?: string | null
          ip_address?: string | null
          request_id?: string | null
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      admin_feature_toggles: {
        Row: {
          enabled: boolean
          id: string
          label: string
          section_key: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: string
          label: string
          section_key: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: string
          label?: string
          section_key?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      super_admins: {
        Row: {
          created_at: string | null
          email: string
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      Vinos: {
        Row: {
          activado: boolean | null
          alergenos_en: string | null
          alergenos_fr: string | null
          alergenos_inferidos: Json | null
          alergenos_notas: string | null
          alergenos_oficiales: Json | null
          categoria: string | null
          categoria_en: string | null
          categoria_fr: string | null
          created_at: string | null
          denominacion_origen: string | null
          descripcion: string | null
          expanded: boolean | null
          featured: boolean | null
          id: string
          copeo: boolean
          imagen_posicion_y: number | null
          precio_copa_eur: number | null
          puntuacion_parker: number | null
          puntuacion_parker_anada: number | null
          imagen_url: string | null
          ingredientes: string | null
          nombre: string | null
          nombre_en: string | null
          nombre_fr: string | null
          orden: string | null
          precio_eur: number | null
          restaurante: boolean | null
          touza: boolean | null
          traducciones: Json | null
          ubicacion_pais: string | null
          ubicacion_pais_en: string | null
          ubicacion_pais_fr: string | null
          ubicacion_region: string | null
          ubicacion_region_en: string | null
          ubicacion_region_fr: string | null
          updated_at: string | null
        }
        Insert: {
          activado?: boolean | null
          alergenos_en?: string | null
          alergenos_fr?: string | null
          alergenos_inferidos?: Json | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          denominacion_origen?: string | null
          descripcion?: string | null
          expanded?: boolean | null
          featured?: boolean | null
          id: string
          copeo?: boolean
          imagen_posicion_y?: number | null
          precio_copa_eur?: number | null
          puntuacion_parker?: number | null
          puntuacion_parker_anada?: number | null
          imagen_url?: string | null
          ingredientes?: string | null
          nombre?: string | null
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: string | null
          precio_eur?: number | null
          restaurante?: boolean | null
          touza?: boolean | null
          traducciones?: Json | null
          ubicacion_pais?: string | null
          ubicacion_pais_en?: string | null
          ubicacion_pais_fr?: string | null
          ubicacion_region?: string | null
          ubicacion_region_en?: string | null
          ubicacion_region_fr?: string | null
          updated_at?: string | null
        }
        Update: {
          activado?: boolean | null
          alergenos_en?: string | null
          alergenos_fr?: string | null
          alergenos_inferidos?: Json | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          categoria?: string | null
          categoria_en?: string | null
          categoria_fr?: string | null
          created_at?: string | null
          denominacion_origen?: string | null
          descripcion?: string | null
          expanded?: boolean | null
          featured?: boolean | null
          id?: string
          copeo?: boolean
          imagen_posicion_y?: number | null
          precio_copa_eur?: number | null
          puntuacion_parker?: number | null
          puntuacion_parker_anada?: number | null
          imagen_url?: string | null
          ingredientes?: string | null
          nombre?: string | null
          nombre_en?: string | null
          nombre_fr?: string | null
          orden?: string | null
          precio_eur?: number | null
          restaurante?: boolean | null
          touza?: boolean | null
          traducciones?: Json | null
          ubicacion_pais?: string | null
          ubicacion_pais_en?: string | null
          ubicacion_pais_fr?: string | null
          ubicacion_region?: string | null
          ubicacion_region_en?: string | null
          ubicacion_region_fr?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      visitas_producto: {
        Row: {
          ciudad: string | null
          created_at: string | null
          id: string
          ip_address: string | null
          pais: string | null
          producto_id: string
          producto_tipo: string
          referer: string | null
          session_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          ciudad?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          pais?: string | null
          producto_id: string
          producto_tipo: string
          referer?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          ciudad?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          pais?: string | null
          producto_id?: string
          producto_tipo?: string
          referer?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      chat_facturas_conversaciones: {
        Row: {
          created_at: string | null
          id: string | null
          session_id: string | null
          titulo: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          session_id?: string | null
          titulo?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          session_id?: string | null
          titulo?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      chat_facturas_mensajes: {
        Row: {
          adjuntos: Json | null
          contenido: string | null
          conversacion_id: string | null
          created_at: string | null
          id: string | null
          rol: string | null
          session_id: string | null
        }
        Insert: {
          adjuntos?: Json | null
          contenido?: string | null
          conversacion_id?: string | null
          created_at?: string | null
          id?: string | null
          rol?: string | null
          session_id?: string | null
        }
        Update: {
          adjuntos?: Json | null
          contenido?: string | null
          conversacion_id?: string | null
          created_at?: string | null
          id?: string | null
          rol?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_chat_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "chat_facturas_conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_chat_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_chat_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_facturas_conversaciones"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "mensajes_chat_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["session_id"]
          },
        ]
      }
      chat_web_uso_diario: {
        Row: {
          cached_tokens: number | null
          completion_tokens: number | null
          conversaciones: number | null
          coste_usd: number | null
          dia: string | null
          peticiones: number | null
          prompt_tokens: number | null
          rechazadas: number | null
        }
        Relationships: []
      }
      ia_uso_diario: {
        Row: {
          cached_tokens: number | null
          completion_tokens: number | null
          coste_usd: number | null
          dia: string | null
          errores: number | null
          funcion: string | null
          llamadas: number | null
          modelo: string | null
          peticiones: number | null
          prompt_tokens: number | null
          razonamiento_tokens: number | null
        }
        Relationships: []
      }
      instagram_metricas_publicacion_ultima: {
        Row: {
          alcance: number | null
          capturado_at: string | null
          caption: string | null
          comentarios: number | null
          compartidos: number | null
          fecha_captura: string | null
          guardados: number | null
          id: number | null
          ig_user_id: string | null
          interacciones: number | null
          me_gusta: number | null
          media_id: string | null
          miniatura_url: string | null
          permalink: string | null
          pieza_id: string | null
          producto: string | null
          publicado_at: string | null
          tipo_medio: string | null
          visualizaciones: number | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_metricas_publicacion_pieza_id_fkey"
            columns: ["pieza_id"]
            isOneToOne: false
            referencedRelation: "instagram_piezas"
            referencedColumns: ["id"]
          },
        ]
      }
      vista_asignacion_dia: {
        Row: {
          espacio_id: string | null
          espacio_nombre: string | null
          estado: string | null
          fecha: string | null
          grado: string | null
          hora: string | null
          marca: string | null
          mesas_asignadas: number | null
          mesas_nombres: string[] | null
          nombre: string | null
          numero_comensales: number | null
          plazas_asignadas: number | null
          reserva_id: string | null
          turno: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
        ]
      }
      vista_calidad_audio: {
        Row: {
          audio_metrics: Json | null
          audio_score: number | null
          call_success: boolean | null
          created_at: string | null
          duration_seconds: number | null
          early_hangup: boolean | null
          ended_reason: string | null
          interruption_count: number | null
          interruption_rate: number | null
          latency_avg_ms: number | null
          latency_first_ms: number | null
          latency_max_ms: number | null
          latency_p50_ms: number | null
          latency_p95_ms: number | null
          long_silences: number | null
          number_cutoffs: number | null
          sentiment: string | null
          turn_count: number | null
          vapi_call_id: string | null
        }
        Insert: {
          audio_metrics?: Json | null
          audio_score?: never
          call_success?: boolean | null
          created_at?: string | null
          duration_seconds?: number | null
          early_hangup?: never
          ended_reason?: string | null
          interruption_count?: never
          interruption_rate?: never
          latency_avg_ms?: never
          latency_first_ms?: never
          latency_max_ms?: never
          latency_p50_ms?: never
          latency_p95_ms?: never
          long_silences?: never
          number_cutoffs?: never
          sentiment?: string | null
          turn_count?: never
          vapi_call_id?: string | null
        }
        Update: {
          audio_metrics?: Json | null
          audio_score?: never
          call_success?: boolean | null
          created_at?: string | null
          duration_seconds?: number | null
          early_hangup?: never
          ended_reason?: string | null
          interruption_count?: never
          interruption_rate?: never
          latency_avg_ms?: never
          latency_first_ms?: never
          latency_max_ms?: never
          latency_p50_ms?: never
          latency_p95_ms?: never
          long_silences?: never
          number_cutoffs?: never
          sentiment?: string | null
          turn_count?: never
          vapi_call_id?: string | null
        }
        Relationships: []
      }
      vista_estadisticas_mensuales: {
        Row: {
          comensales_confirmados: number | null
          mes_fin: string | null
          mes_inicio: string | null
          reservas_canceladas: number | null
          reservas_confirmadas: number | null
          total_comensales: number | null
          total_reservas: number | null
        }
        Relationships: []
      }
      vista_estadisticas_semanales: {
        Row: {
          comensales_confirmados: number | null
          reservas_canceladas: number | null
          reservas_cena: number | null
          reservas_comida: number | null
          reservas_confirmadas: number | null
          reservas_no_show: number | null
          semana_fin: string | null
          semana_inicio: string | null
          total_comensales: number | null
          total_reservas: number | null
        }
        Relationships: []
      }
      vista_gastos_mensuales: {
        Row: {
          mes: string | null
          num_albaranes: number | null
          num_facturas: number | null
          num_proveedores: number | null
          promedio_factura: number | null
          total_facturas: number | null
        }
        Relationships: []
      }
      vista_gastos_proveedor_mes: {
        Row: {
          mes: string | null
          num_facturas: number | null
          promedio_factura: number | null
          proveedor_nombre: string | null
          proveedor_normalizado: string | null
          total_mes: number | null
        }
        Relationships: []
      }
      vista_ocupacion: {
        Row: {
          dia_semana: number | null
          fecha: string | null
          hora: string | null
          total_comensales: number | null
          total_reservas: number | null
          turno: string | null
        }
        Insert: {
          dia_semana?: number | null
          fecha?: string | null
          hora?: string | null
          total_comensales?: number | null
          total_reservas?: number | null
          turno?: string | null
        }
        Update: {
          dia_semana?: number | null
          fecha?: string | null
          hora?: string | null
          total_comensales?: number | null
          total_reservas?: number | null
          turno?: string | null
        }
        Relationships: []
      }
      vista_ocupacion_hoy: {
        Row: {
          comensales_activos: number | null
          comensales_confirmados: number | null
          reservas_activas: number | null
          reservas_canceladas: number | null
          reservas_completadas: number | null
          reservas_confirmadas: number | null
          reservas_no_show: number | null
          reservas_pendientes: number | null
          reservas_verificadas: number | null
          total_comensales: number | null
          total_reservas: number | null
        }
        Relationships: []
      }
      vista_productos_top: {
        Row: {
          cantidad_total: number | null
          nombre_completo: string | null
          nombre_normalizado: string | null
          num_proveedores: number | null
          precio_maximo: number | null
          precio_minimo: number | null
          precio_promedio: number | null
          unidad: string | null
          veces_comprado: number | null
          veces_con_precio: number | null
        }
        Relationships: []
      }
      vista_productos_vendidos: {
        Row: {
          nombre_producto: string | null
          producto_id: string | null
          producto_tipo: string | null
          total_ingresos: number | null
          unidades_vendidas: number | null
        }
        Relationships: []
      }
      vista_proveedores_resumen: {
        Row: {
          cif: string | null
          num_albaranes: number | null
          num_documentos: number | null
          num_facturas: number | null
          primera_compra: string | null
          proveedor_nombre_completo: string | null
          proveedor_normalizado: string | null
          ticket_promedio: number | null
          total_gastado: number | null
          ultima_compra: string | null
        }
        Relationships: []
      }
      vista_reservas_pendientes: {
        Row: {
          email: string | null
          estado: string | null
          fecha: string | null
          fecha_solicitud: string | null
          hora: string | null
          id: string | null
          nombre_cliente: string | null
          numero_comensales: number | null
          telefono: string | null
        }
        Insert: {
          email?: string | null
          estado?: string | null
          fecha?: string | null
          fecha_solicitud?: string | null
          hora?: string | null
          id?: string | null
          nombre_cliente?: string | null
          numero_comensales?: number | null
          telefono?: string | null
        }
        Update: {
          email?: string | null
          estado?: string | null
          fecha?: string | null
          fecha_solicitud?: string | null
          hora?: string | null
          id?: string | null
          nombre_cliente?: string | null
          numero_comensales?: number | null
          telefono?: string | null
        }
        Relationships: []
      }
      vista_stock_consolidado: {
        Row: {
          activado: boolean | null
          categoria: string | null
          id: string | null
          nombre: string | null
          precio_eur: number | null
          stock: number | null
          tipo: string | null
        }
        Relationships: []
      }
      vista_turnos_con_areas: {
        Row: {
          areas_asignadas: string[] | null
          areas_ids: string[] | null
          created_at: string | null
          estado: Database["public"]["Enums"]["estado_turno"] | null
          fecha: string | null
          hora_fin: string | null
          hora_inicio: string | null
          id: string | null
          notas: string | null
          puesto: Database["public"]["Enums"]["puesto_trabajo"] | null
          trabajador_id: string | null
          trabajador_nombre: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "turnos_trabajador_id_fkey"
            columns: ["trabajador_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      vista_ultimos_documentos: {
        Row: {
          drive_url: string | null
          fecha: string | null
          fecha_procesado: string | null
          id: number | null
          num_productos: number | null
          numero_documento: string | null
          proveedor: string | null
          proveedor_normalizado: string | null
          tipo: string | null
          total: number | null
        }
        Relationships: []
      }
      vista_ventas_diarias: {
        Row: {
          fecha: string | null
          num_pedidos: number | null
          ticket_medio: number | null
          total_ventas: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      configuracion_web_visibilidad_menu_tapas: {
        Args: { p_seccion: string; p_mostrar: boolean }
        Returns: undefined
      }
      // Días y horas de «Menú del día» y «Tapas» (migración 20261104142000_horario_menu_tapas).
      configuracion_web_horario_menu_tapas: {
        Args: { p_seccion: string; p_horario: Json | null }
        Returns: undefined
      }
      // «Vota tu vino favorito» (migración 20261104141000_encuesta_vino_favorito).
      votar_vino_favorito: {
        Args: { p_vino_id: string; p_nombre: string; p_contacto: string; p_acepta_bases: boolean; p_idioma?: string }
        Returns: Json
      }
      // Tienda de vinos (migración 20261103150000_tienda_vinos).
      tienda_precio_venta: {
        Args: { p_precio_carta: number; p_descuento_pct: number }
        Returns: number
      }
      tienda_marcar_vinos: {
        Args: { p_vino_ids: string[]; p_a_la_venta: boolean }
        Returns: string[]
      }
      version_auditoria_panel: { Args: Record<PropertyKey, never>; Returns: number }
      registrar_acceso_panel: { Args: { p_tipo: string; p_ruta?: string }; Returns: string }
      auditar_prompt_vapi: { Args: { p_evento?: string; p_resultado?: string }; Returns: string }
      listar_tablas_auditoria_panel: { Args: Record<PropertyKey, never>; Returns: { tabla: string }[] }
      registrar_accion_auditoria_panel: { Args: { p_operacion: string; p_detalles?: Json }; Returns: string }
      iniciar_intento_panel: { Args: { p_email: string; p_ruta?: string }; Returns: Json }
      finalizar_intento_panel: { Args: { p_id: string; p_actor?: string; p_resultado?: string; p_session_id?: string }; Returns: undefined }

      // Albarán ↔ factura y cotejo (migración 20261010110000_albaranes_factura_cotejo).
      vincular_albaran_factura: {
        Args: { p_albaran_id: number; p_factura_id: number; p_forzar?: boolean }
        Returns: Json
      }
      desvincular_albaran: { Args: { p_albaran_id: number }; Returns: Json }
      albaranes_candidatos: {
        Args: { p_factura_id: number; p_texto?: string | null }
        Returns: {
          id: number
          numero_documento: string
          fecha: string | null
          proveedor: string | null
          total: number | null
          base: number | null
          lineas: number
          citado_en_factura: boolean
          mismo_proveedor: boolean
          dias: number | null
        }[]
      }
      facturas_candidatas: {
        Args: { p_albaran_id: number }
        Returns: {
          id: number
          numero_documento: string
          fecha: string | null
          total: number | null
          base: number | null
          lineas: number
          cita_albaran: boolean
          dias: number | null
        }[]
      }
      cotejo_factura_albaranes: {
        Args: { p_factura_id: number; p_albaran_id?: number | null }
        Returns: Json
      }

      append_tool_call_log: {
        Args: { p_call_id: string; p_new_tools: Json }
        Returns: undefined
      }
      asignar_mesas_reserva: {
        Args: { p_mesa_ids: string[]; p_reserva_id: string }
        Returns: {
          asignada_por: string | null
          created_at: string | null
          espacio_id: string | null
          fecha: string | null
          id: string
          mesa_id: string
          reserva_id: string
          turno: string | null
        }[]
      }
      buscar_contexto_chatbot: {
        Args: { embedding_query: string }
        Returns: Json
      }
      buscar_facturas_agente: {
        Args: { embedding_query: string; limite?: number; umbral?: number }
        Returns: Json
      }
      buscar_facturas_por_contexto: {
        Args: { limite?: number; query_embedding: string }
        Returns: {
          fecha: string
          id: number
          numero_documento: string
          observaciones: string
          proveedor: string
          similitud: number
          tipo: string
        }[]
      }
      buscar_producto: {
        Args: { termino: string }
        Returns: {
          nombre: string
          precio_promedio: number
          ultima_fecha: string
          ultimo_precio: number
          veces_comprado: number
        }[]
      }
      buscar_productos_agente: {
        Args: { embedding_query: string; limite?: number; umbral?: number }
        Returns: Json
      }
      buscar_productos_similares: {
        Args: { limite?: number; query_embedding: string }
        Returns: {
          cantidad: number
          fecha: string
          id: number
          nombre: string
          precio_unitario: number
          proveedor: string
          similitud: number
        }[]
      }
      bytea_to_text: { Args: { data: string }; Returns: string }
      can_read_section: { Args: { _section: string }; Returns: boolean }
      can_write_section: { Args: { _section: string }; Returns: boolean }
      cleanup_old_security_logs: { Args: never; Returns: undefined }
      cleanup_rate_limit_log: { Args: never; Returns: undefined }
      ejecutar_consulta_chatbot: { Args: { query_sql: string }; Returns: Json }
      fn_aceptar_propuesta_solicitud: {
        Args: { p_solicitud_id: string; p_via?: string }
        Returns: Json
      }
      fn_asignaciones_futuras_de_mesas: {
        Args: { p_mesa_ids: string[] }
        Returns: {
          fecha: string
          mesa_id: string
          mesa_nombre: string
          reserva_nombre: string
          turno: string
        }[]
      }
      fn_normalizar_telefono: { Args: { p_telefono: string }; Returns: string }
      fn_rechazar_propuesta_solicitud: {
        Args: { p_solicitud_id: string; p_via?: string }
        Returns: Json
      }
      ejecutar_limpieza_gdpr: {
        Args: never
        Returns: {
          accion: string
          registros_procesados: number
          tabla: string
        }[]
      }
      estadisticas_globales_agente: { Args: never; Returns: Json }
      gastos_periodo: {
        Args: { fecha_fin: string; fecha_inicio: string }
        Returns: {
          num_facturas: number
          proveedor_principal: string
          ticket_promedio: number
          total_gastado: number
        }[]
      }
      get_call_logs_analytics: {
        Args: { p_call_type?: string; p_date_from: string; p_date_to: string }
        Returns: Json
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_section_permission: {
        Args: { _permission: string; _section: string; _user_id: string }
        Returns: boolean
      }
      instagram_cancelar_programacion: {
        Args: { p_id: string }
        Returns: Json
      }
      instagram_programar: {
        Args: {
          p_confirmar_conflicto?: boolean
          p_para: string
          p_pieza_id: string
        }
        Returns: Json
      }
      instagram_reprogramar: {
        Args: {
          p_confirmar_conflicto?: boolean
          p_id: string
          p_para: string
        }
        Returns: Json
      }
      http: {
        Args: { request: Database["public"]["CompositeTypes"]["http_request"] }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "http_request"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_get:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_head: {
        Args: { uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: Database["public"]["CompositeTypes"]["http_header"]
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_list_curlopt: {
        Args: never
        Returns: {
          curlopt: string
          value: string
        }[]
      }
      http_patch: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_post:
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_put: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_reset_curlopt: { Args: never; Returns: boolean }
      http_set_curlopt: {
        Args: { curlopt: string; value: string }
        Returns: boolean
      }
      ia_coste_alternativa: {
        Args: { p_desde?: string; p_hasta?: string; p_modelo_alternativo: string }
        Returns: {
          coste_alternativo_usd: number | null
          coste_real_usd: number | null
          diferencia_pct: number | null
          diferencia_usd: number | null
          modelo_alternativo: string
          modelo_real: string
          peticiones: number
        }[]
      }
      ia_coste_mes: {
        Args: never
        Returns: {
          coste_acumulado_usd: number | null
          dias_con_dato: number
          dias_mes: number
          dias_restantes: number
          estimado_ia_usd_mes: number | null
          fijos_eur_mes: number | null
          fijos_sin_verificar: number
          mes: string
          peticiones: number | null
          proy_lineal_usd: number | null
          proy_media7_usd: number | null
          usd_medio_dia: number | null
        }[]
      }
      ia_coste_por_funcion: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: {
          completion_tokens: number
          coste_usd: number | null
          descripcion: string | null
          errores: number
          funcion: string
          instrumentada: boolean
          llamadas: number
          pct: number | null
          peticiones: number
          prompt_tokens: number
          razonamiento_tokens: number
          usd_por_peticion: number | null
        }[]
      }
      ia_coste_por_modelo: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: {
          cached_tokens: number
          completion_tokens: number
          coste_usd: number | null
          llamadas: number
          modelo: string
          pct: number | null
          pct_razonamiento: number | null
          peticiones: number
          prompt_tokens: number
          razonamiento_tokens: number
          tarifado: boolean
          usd_por_peticion: number | null
        }[]
      }
      ia_coste_serie: {
        Args: { p_desde?: string; p_funcion?: string | null; p_hasta?: string }
        Returns: {
          completion_tokens: number | null
          coste_usd: number | null
          desv_30: number | null
          desviacion_pct: number | null
          dia: string
          errores: number | null
          es_anomalia: boolean | null
          llamadas: number | null
          media_30: number | null
          media_7: number | null
          peticiones: number | null
          prompt_tokens: number | null
          razonamiento_tokens: number | null
          z_30: number | null
        }[]
      }
      ia_funciones_sin_registro: {
        Args: { p_dias?: number }
        Returns: {
          descripcion: string | null
          dias_sin_registro: number | null
          funcion: string
          instrumentada: boolean
          ultima_fila: string | null
        }[]
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      /** Solo existe si 20261003171500_newsletter_baja_automatica.sql está aplicada. Solo service_role (resend-webhook). */
      newsletter_estadisticas_broadcasts: {
        Args: { p_broadcast_ids: string[] }
        Returns: {
          broadcast_id: string
          destinatarios: number
          eventos: number
          tipo_evento: string
        }[]
      }
      newsletter_marcar_sincronizados: {
        Args: { p_items: Json }
        Returns: number
      }
      newsletter_registrar_baja: {
        Args: { p_email: string; p_origen: string; p_suscriptor_id?: string | null }
        Returns: number
      }
      normalizar_nombre_producto: {
        Args: { p_nombre: string }
        Returns: string
      }
      normalizar_cif: { Args: { p_cif: string }; Returns: string }
      normalizar_proveedor: { Args: { p_proveedor: string }; Returns: string }
      normalizar_proveedor_base: {
        Args: { p_proveedor: string }
        Returns: string
      }
      normalizar_texto: { Args: { p_texto: string }; Returns: string }
      productos_asignar_lineas: {
        Args: {
          p_categoria_id?: number | null
          p_linea_ids: number[]
          p_nombre_nuevo?: string | null
          p_producto_id?: number | null
        }
        Returns: Json
      }
      productos_borrar: { Args: { p_producto_id: number }; Returns: undefined }
      productos_contenido_guardar: {
        Args: { p_cantidad: number | null; p_producto_id: number; p_unidad: string | null }
        Returns: Json
      }
      productos_fusionar: {
        Args: { p_destino_id: number; p_origen_ids: number[] }
        Returns: Json
      }
      productos_gasto_por_categoria: {
        Args: { p_desde?: string | null; p_hasta?: string | null; p_tipo?: string | null }
        Returns: {
          categoria: string
          categoria_id: number | null
          gasto: number
          lineas: number
          lineas_sin_importe: number
          padre: string | null
          padre_id: number | null
          productos: number
          sin_clasificar: boolean
        }[]
      }
      productos_puede_editar: { Args: never; Returns: boolean }
      productos_recategorizar: {
        Args: { p_categoria_id: number | null; p_producto_ids: number[] }
        Returns: number
      }
      productos_renombrar: {
        Args: { p_nombre: string; p_producto_id: number }
        Returns: Json
      }
      productos_resumen: {
        Args: { p_desde?: string | null; p_hasta?: string | null; p_tipo?: string | null }
        Returns: {
          cantidades: Json
          categoria_id: number | null
          compras: number
          documentos: number
          gasto: number
          lineas_sin_importe: number
          nombre: string
          origen: string
          producto_id: number
          proveedores: string[]
          ultima_fecha: string | null
          ultimo_precio: number | null
          unidad_habitual: string | null
        }[]
      }
      proveedores_editar: {
        Args: {
          p_cif?: string | null
          p_id: number
          p_nombre: string
          p_nombre_comercial?: string | null
        }
        Returns: Json
      }
      proveedores_fusionar: {
        Args: { p_destino_id: number; p_origen_ids: number[] }
        Returns: Json
      }
      proveedores_listado: {
        Args: never
        Returns: {
          activo: boolean
          albaranes: number
          alias: string[]
          cif: string | null
          cifs_extra: string[]
          documentos: number
          facturas: number
          id: number
          nombre: string
          nombre_comercial: string | null
          origen: string | null
          total_albaranes: number
          total_facturas: number
          ultima_fecha: string | null
          variantes: string[]
        }[]
      }
      proveedores_puede_editar: { Args: never; Returns: boolean }
      recalcular_ocupacion_historica: {
        Args: { fecha_desde?: string; fecha_hasta?: string }
        Returns: number
      }
      text_to_bytea: { Args: { data: string }; Returns: string }
      // Super Admin › Servicios: última lectura de cada proveedor (la RLS decide)
      // y métricas sin token (solo service_role, la usa servicios-uso).
      servicios_uso_ultimas: {
        Args: Record<PropertyKey, never>
        Returns: {
          coste_variable: Json | null
          detalles: Json
          error: string | null
          id: string
          metricas: Json
          proveedor: string
          tomado_en: string
        }[]
      }
      servicios_metricas_supabase: { Args: Record<PropertyKey, never>; Returns: Json }
      trafico_web_desglose_resumen: {
        Args: {
          p_desde?: string
          p_dimension?: string
          p_hasta?: string
          p_limite?: number
          p_proyecto?: string | null
        }
        Returns: {
          pct: number | null
          valor: string
          visitantes: number | null
          visitas: number
        }[]
      }
      trafico_web_fdt_mes: {
        Args: { p_mes?: string | null }
        Returns: {
          alerta_80: boolean
          bytes_acumulados: number | null
          bytes_medios_por_visita: number | null
          bytes_proy_lineal: number | null
          bytes_proy_regresion: number | null
          dias_con_dato: number
          dias_mes: number
          dias_restantes: number
          limite_bytes: number
          pct_limite: number | null
          pct_proyectado: number | null
          proyecto: string
          visitas_mes: number | null
        }[]
      }
      trafico_web_serie: {
        Args: { p_desde?: string; p_hasta?: string; p_proyecto?: string | null }
        Returns: {
          desv_30: number | null
          desv_dow: number | null
          desviacion_pct: number | null
          es_anomalia: boolean | null
          fecha: string
          media_30: number | null
          media_7: number | null
          media_dow: number | null
          n_dow: number
          visitantes: number | null
          visitas: number | null
          z_dow: number | null
        }[]
      }
      trafico_web_tendencia: {
        Args: { p_dias?: number; p_proyecto?: string | null }
        Returns: {
          fiable: boolean | null
          intercepto: number | null
          n: number
          pendiente: number | null
          proyeccion: Json | null
          r2: number | null
          total_30d: number | null
        }[]
      }
      trafico_web_top_paginas: {
        Args: {
          p_desde?: string
          p_hasta?: string
          p_limite?: number
          p_orden?: string
          p_proyecto?: string | null
        }
        Returns: {
          bytes_estimados: number | null
          pct_bytes: number | null
          pct_visitas: number | null
          proyecto: string
          ruta: string
          visitas: number
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      urlencode:
        | { Args: { data: Json }; Returns: string }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      verificar_duplicado_factura: {
        Args: {
          p_fecha: string
          p_numero_documento: string
          p_proveedor: string
          p_total: number
        }
        Returns: Json
      }
      withdraw_stock_inventory: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "staff"
      estado_turno: "programado" | "activo" | "completado" | "cancelado"
      puesto_trabajo:
        | "gerente"
        | "camarero"
        | "ayudante_camarero"
        | "cocinero"
        | "ayudante_cocina"
        | "recepcionista"
        | "limpieza"
    }
    CompositeTypes: {
      http_header: {
        field: string | null
        value: string | null
      }
      http_request: {
        method: unknown
        uri: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content_type: string | null
        content: string | null
      }
      http_response: {
        status: number | null
        content_type: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content: string | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "staff"],
      estado_turno: ["programado", "activo", "completado", "cancelado"],
      puesto_trabajo: [
        "gerente",
        "camarero",
        "ayudante_camarero",
        "cocinero",
        "ayudante_cocina",
        "recepcionista",
        "limpieza",
      ],
    },
  },
} as const
