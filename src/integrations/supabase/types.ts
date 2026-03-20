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
      asignaciones_mesa: {
        Row: {
          created_at: string | null
          id: string
          mesa_id: string
          reserva_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          mesa_id: string
          reserva_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          mesa_id?: string
          reserva_id?: string
        }
        Relationships: [
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
          restaurant_id: string
          started_at: string | null
          status: string | null
          summary: string | null
          tool_calls: Json | null
          vapi_call_id: string | null
        }
        Insert: {
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
          restaurant_id: string
          started_at?: string | null
          status?: string | null
          summary?: string | null
          tool_calls?: Json | null
          vapi_call_id?: string | null
        }
        Update: {
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
          restaurant_id?: string
          started_at?: string | null
          status?: string | null
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
          auto_confirmar: boolean
          created_at: string
          dias_max_antelacion: number
          email_obligatorio: boolean
          id: string
          max_comensales_por_reserva: number
          max_reservas_por_email_dia: number
          max_reservas_por_telefono_dia: number
          min_comensales_por_reserva: number
          minutos_corte_antes_servicio: number
          telefono_obligatorio: boolean
          updated_at: string
        }
        Insert: {
          auto_confirmar?: boolean
          created_at?: string
          dias_max_antelacion?: number
          email_obligatorio?: boolean
          id?: string
          max_comensales_por_reserva?: number
          max_reservas_por_email_dia?: number
          max_reservas_por_telefono_dia?: number
          min_comensales_por_reserva?: number
          minutos_corte_antes_servicio?: number
          telefono_obligatorio?: boolean
          updated_at?: string
        }
        Update: {
          auto_confirmar?: boolean
          created_at?: string
          dias_max_antelacion?: number
          email_obligatorio?: boolean
          id?: string
          max_comensales_por_reserva?: number
          max_reservas_por_email_dia?: number
          max_reservas_por_telefono_dia?: number
          min_comensales_por_reserva?: number
          minutos_corte_antes_servicio?: number
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
          cif: string | null
          created_at: string | null
          drive_url: string | null
          embedding: string | null
          embedding_observaciones: string | null
          fecha: string
          id: number
          iva: number | null
          numero_documento: string
          observaciones: string | null
          procesado_en: string | null
          proveedor: string | null
          proveedor_normalizado: string | null
          resumen: string | null
          subtotal: number | null
          tipo: string
          total: number | null
          updated_at: string | null
          verificada: boolean | null
        }
        Insert: {
          cif?: string | null
          created_at?: string | null
          drive_url?: string | null
          embedding?: string | null
          embedding_observaciones?: string | null
          fecha: string
          id?: number
          iva?: number | null
          numero_documento: string
          observaciones?: string | null
          procesado_en?: string | null
          proveedor?: string | null
          proveedor_normalizado?: string | null
          resumen?: string | null
          subtotal?: number | null
          tipo: string
          total?: number | null
          updated_at?: string | null
          verificada?: boolean | null
        }
        Update: {
          cif?: string | null
          created_at?: string | null
          drive_url?: string | null
          embedding?: string | null
          embedding_observaciones?: string | null
          fecha?: string
          id?: number
          iva?: number | null
          numero_documento?: string
          observaciones?: string | null
          procesado_en?: string | null
          proveedor?: string | null
          proveedor_normalizado?: string | null
          resumen?: string | null
          subtotal?: number | null
          tipo?: string
          total?: number | null
          updated_at?: string | null
          verificada?: boolean | null
        }
        Relationships: []
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
          content: string
          conversacion_id: string | null
          created_at: string | null
          id: string
          role: string
          session_id: string
        }
        Insert: {
          content: string
          conversacion_id?: string | null
          created_at?: string | null
          id?: string
          role: string
          session_id: string
        }
        Update: {
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
          menu: Json
        }
        Insert: {
          fecha: string
          id?: string
          menu: Json
        }
        Update: {
          fecha?: string
          id?: string
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
          espacio_id: string
          etiqueta: string | null
          forma: string
          id: string
          is_merged: boolean | null
          nombre: string
          original_mesas: Json | null
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
          espacio_id: string
          etiqueta?: string | null
          forma?: string
          id?: string
          is_merged?: boolean | null
          nombre: string
          original_mesas?: Json | null
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
          espacio_id?: string
          etiqueta?: string | null
          forma?: string
          id?: string
          is_merged?: boolean | null
          nombre?: string
          original_mesas?: Json | null
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
          created_at: string
          enviado_por: string | null
          estado: string | null
          id: string
          mensaje: string
          tipo_newsletter: string | null
          total_destinatarios: number
        }
        Insert: {
          asunto: string
          created_at?: string
          enviado_por?: string | null
          estado?: string | null
          id?: string
          mensaje: string
          tipo_newsletter?: string | null
          total_destinatarios?: number
        }
        Update: {
          asunto?: string
          created_at?: string
          enviado_por?: string | null
          estado?: string | null
          id?: string
          mensaje?: string
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
          id: string
          nombre: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          email: string
          id?: string
          nombre?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          email?: string
          id?: string
          nombre?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      noticias_hosteleria: {
        Row: {
          categoria: string
          created_at: string
          descripcion: string | null
          enlace: string
          fecha: string
          fuente: string
          id: string
          titulo: string
          updated_at: string
        }
        Insert: {
          categoria: string
          created_at?: string
          descripcion?: string | null
          enlace: string
          fecha?: string
          fuente: string
          id?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          categoria?: string
          created_at?: string
          descripcion?: string | null
          enlace?: string
          fecha?: string
          fuente?: string
          id?: string
          titulo?: string
          updated_at?: string
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
        }
        Relationships: []
      }
      productos_catalogo: {
        Row: {
          activo: boolean | null
          categoria: string | null
          created_at: string | null
          id: number
          nombre: string
          notas: string | null
          precio_actual: number | null
          proveedor_habitual_id: number | null
          unidad_medida: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          categoria?: string | null
          created_at?: string | null
          id?: number
          nombre: string
          notas?: string | null
          precio_actual?: number | null
          proveedor_habitual_id?: number | null
          unidad_medida?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          categoria?: string | null
          created_at?: string | null
          id?: number
          nombre?: string
          notas?: string | null
          precio_actual?: number | null
          proveedor_habitual_id?: number | null
          unidad_medida?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_catalogo_proveedor_habitual_id_fkey"
            columns: ["proveedor_habitual_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      productos_factura: {
        Row: {
          cantidad: number
          created_at: string | null
          embedding: string | null
          factura_id: number
          id: number
          nombre: string
          nombre_normalizado: string | null
          precio_unitario: number | null
          total: number | null
          unidad: string | null
        }
        Insert: {
          cantidad?: number
          created_at?: string | null
          embedding?: string | null
          factura_id: number
          id?: number
          nombre: string
          nombre_normalizado?: string | null
          precio_unitario?: number | null
          total?: number | null
          unidad?: string | null
        }
        Update: {
          cantidad?: number
          created_at?: string | null
          embedding?: string | null
          factura_id?: number
          id?: number
          nombre?: string
          nombre_normalizado?: string | null
          precio_unitario?: number | null
          total?: number | null
          unidad?: string | null
        }
        Relationships: [
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
          created_at: string | null
          direccion: string | null
          email: string | null
          id: number
          nombre: string
          notas: string | null
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
          notas?: string | null
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
          notas?: string | null
          telefono?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
          created_at: string | null
          email: string | null
          en_blacklist: boolean | null
          espacio_id: string | null
          estado: string
          fecha: string
          hora: string
          id: string
          importante: boolean
          nombre: string | null
          notas_cliente: string | null
          numero_comensales: number
          telefono: string | null
          updated_at: string | null
        }
        Insert: {
          canal?: string | null
          created_at?: string | null
          email?: string | null
          en_blacklist?: boolean | null
          espacio_id?: string | null
          estado?: string
          fecha: string
          hora: string
          id?: string
          importante?: boolean
          nombre?: string | null
          notas_cliente?: string | null
          numero_comensales: number
          telefono?: string | null
          updated_at?: string | null
        }
        Update: {
          canal?: string | null
          created_at?: string | null
          email?: string | null
          en_blacklist?: boolean | null
          espacio_id?: string | null
          estado?: string
          fecha?: string
          hora?: string
          id?: string
          importante?: boolean
          nombre?: string | null
          notas_cliente?: string | null
          numero_comensales?: number
          telefono?: string | null
          updated_at?: string | null
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
      solicitudes_pendientes: {
        Row: {
          created_at: string | null
          descripcion_rechazo: string | null
          email: string | null
          estado: string
          fecha_solicitada: string | null
          hora_solicitada: string | null
          id: string
          motivo_rechazo: string
          nombre: string | null
          notas_cliente: string | null
          notas_internas: string | null
          numero_comensales: number | null
          telefono: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          descripcion_rechazo?: string | null
          email?: string | null
          estado?: string
          fecha_solicitada?: string | null
          hora_solicitada?: string | null
          id?: string
          motivo_rechazo: string
          nombre?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          numero_comensales?: number | null
          telefono?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          descripcion_rechazo?: string | null
          email?: string | null
          estado?: string
          fecha_solicitada?: string | null
          hora_solicitada?: string | null
          id?: string
          motivo_rechazo?: string
          nombre?: string | null
          notas_cliente?: string | null
          notas_internas?: string | null
          numero_comensales?: number | null
          telefono?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      tapas: {
        Row: {
          fecha: string
          id: string
          tapas: Json
        }
        Insert: {
          fecha: string
          id?: string
          tapas: Json
        }
        Update: {
          fecha?: string
          id?: string
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
          contenido: string | null
          conversacion_id: string | null
          created_at: string | null
          id: string | null
          rol: string | null
          session_id: string | null
        }
        Insert: {
          contenido?: string | null
          conversacion_id?: string | null
          created_at?: string | null
          id?: string | null
          rol?: string | null
          session_id?: string | null
        }
        Update: {
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
          comensales_confirmados: number | null
          reservas_canceladas: number | null
          reservas_confirmadas: number | null
          reservas_pendientes: number | null
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
      append_tool_call_log: {
        Args: { p_call_id: string; p_new_tools: Json }
        Returns: undefined
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
      cleanup_old_security_logs: { Args: never; Returns: undefined }
      cleanup_rate_limit_log: { Args: never; Returns: undefined }
      ejecutar_consulta_chatbot: { Args: { query_sql: string }; Returns: Json }
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
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_section_permission: {
        Args: { _permission: string; _section: string; _user_id: string }
        Returns: boolean
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
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      normalizar_nombre_producto: {
        Args: { p_nombre: string }
        Returns: string
      }
      normalizar_proveedor: { Args: { p_proveedor: string }; Returns: string }
      normalizar_texto: { Args: { p_texto: string }; Returns: string }
      recalcular_ocupacion_historica: {
        Args: { fecha_desde?: string; fecha_hasta?: string }
        Returns: number
      }
      text_to_bytea: { Args: { data: string }; Returns: string }
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
