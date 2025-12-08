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
          created_at: string | null
          descripcion: string | null
          id: string
          imagen_url: string | null
          nombre: string | null
          orden: number | null
          precio_eur: number | null
          tamano: string | null
          updated_at: string | null
        }
        Insert: {
          activado?: boolean | null
          categoria?: string | null
          created_at?: string | null
          descripcion?: string | null
          id: string
          imagen_url?: string | null
          nombre?: string | null
          orden?: number | null
          precio_eur?: number | null
          tamano?: string | null
          updated_at?: string | null
        }
        Update: {
          activado?: boolean | null
          categoria?: string | null
          created_at?: string | null
          descripcion?: string | null
          id?: string
          imagen_url?: string | null
          nombre?: string | null
          orden?: number | null
          precio_eur?: number | null
          tamano?: string | null
          updated_at?: string | null
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
      mesas: {
        Row: {
          activa: boolean | null
          alto: number | null
          ancho: number | null
          capacidad: number
          created_at: string | null
          espacio_id: string
          forma: string
          id: string
          nombre: string
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
          forma?: string
          id?: string
          nombre: string
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
          forma?: string
          id?: string
          nombre?: string
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
          {
            foreignKeyName: "mesas_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "vista_ocupacion_hoy"
            referencedColumns: ["espacio_id"]
          },
        ]
      }
      ocupacion_diaria: {
        Row: {
          created_at: string | null
          espacio_id: string
          fecha: string
          hora: string | null
          id: string
          sala_id: string
          total_comensales: number
          total_reservas: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          espacio_id: string
          fecha: string
          hora?: string | null
          id?: string
          sala_id: string
          total_comensales?: number
          total_reservas?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          espacio_id?: string
          fecha?: string
          hora?: string | null
          id?: string
          sala_id?: string
          total_comensales?: number
          total_reservas?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocupacion_diaria_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocupacion_diaria_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "vista_ocupacion_hoy"
            referencedColumns: ["espacio_id"]
          },
          {
            foreignKeyName: "ocupacion_diaria_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocupacion_diaria_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "vista_ocupacion_hoy"
            referencedColumns: ["espacio_id"]
          },
        ]
      }
      planos_espacio: {
        Row: {
          alto: number | null
          ancho: number | null
          configuracion: Json | null
          created_at: string | null
          espacio_id: string
          id: string
          metros_cuadrados: number | null
          updated_at: string | null
        }
        Insert: {
          alto?: number | null
          ancho?: number | null
          configuracion?: Json | null
          created_at?: string | null
          espacio_id: string
          id?: string
          metros_cuadrados?: number | null
          updated_at?: string | null
        }
        Update: {
          alto?: number | null
          ancho?: number | null
          configuracion?: Json | null
          created_at?: string | null
          espacio_id?: string
          id?: string
          metros_cuadrados?: number | null
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
          {
            foreignKeyName: "planos_espacio_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: true
            referencedRelation: "vista_ocupacion_hoy"
            referencedColumns: ["espacio_id"]
          },
        ]
      }
      Platos: {
        Row: {
          activado: boolean | null
          alergenos_inferidos: Json | null
          alergenos_notas: string | null
          alergenos_oficiales: Json | null
          categoria: string | null
          created_at: string | null
          descripcion: string | null
          id: string
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
          created_at?: string | null
          descripcion?: string | null
          id: string
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
          created_at?: string | null
          descripcion?: string | null
          id?: string
          imagen_url?: string | null
          nombre?: string | null
          orden?: string | null
          precio_eur?: number | null
          unidad?: string | null
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
          created_at: string | null
          email: string | null
          estado: string
          fecha: string
          hora: string
          id: string
          nombre: string | null
          notas_cliente: string | null
          numero_comensales: number
          sala_id: string
          telefono: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          estado?: string
          fecha: string
          hora: string
          id?: string
          nombre?: string | null
          notas_cliente?: string | null
          numero_comensales: number
          sala_id: string
          telefono?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          estado?: string
          fecha?: string
          hora?: string
          id?: string
          nombre?: string | null
          notas_cliente?: string | null
          numero_comensales?: number
          sala_id?: string
          telefono?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "vista_ocupacion_hoy"
            referencedColumns: ["espacio_id"]
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
      Vinos: {
        Row: {
          activado: boolean | null
          alergenos_inferidos: Json | null
          alergenos_notas: string | null
          alergenos_oficiales: Json | null
          categoria: string | null
          created_at: string | null
          denominacion_origen: string | null
          descripcion: string | null
          id: string
          imagen_url: string | null
          nombre: string | null
          orden: string | null
          precio_eur: number | null
          ubicacion_pais: string | null
          ubicacion_region: string | null
          updated_at: string | null
        }
        Insert: {
          activado?: boolean | null
          alergenos_inferidos?: Json | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          categoria?: string | null
          created_at?: string | null
          denominacion_origen?: string | null
          descripcion?: string | null
          id: string
          imagen_url?: string | null
          nombre?: string | null
          orden?: string | null
          precio_eur?: number | null
          ubicacion_pais?: string | null
          ubicacion_region?: string | null
          updated_at?: string | null
        }
        Update: {
          activado?: boolean | null
          alergenos_inferidos?: Json | null
          alergenos_notas?: string | null
          alergenos_oficiales?: Json | null
          categoria?: string | null
          created_at?: string | null
          denominacion_origen?: string | null
          descripcion?: string | null
          id?: string
          imagen_url?: string | null
          nombre?: string | null
          orden?: string | null
          precio_eur?: number | null
          ubicacion_pais?: string | null
          ubicacion_region?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      vista_ocupacion: {
        Row: {
          capacidad_disponible: number | null
          capacidad_maxima: number | null
          espacio: string | null
          espacio_id: string | null
          fecha: string | null
          hora: string | null
          porcentaje_ocupacion: number | null
          total_comensales: number | null
          total_reservas: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ocupacion_diaria_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "espacios_reserva"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocupacion_diaria_espacio_id_fkey"
            columns: ["espacio_id"]
            isOneToOne: false
            referencedRelation: "vista_ocupacion_hoy"
            referencedColumns: ["espacio_id"]
          },
        ]
      }
      vista_ocupacion_hoy: {
        Row: {
          capacidad_maxima: number | null
          espacio_id: string | null
          espacio_nombre: string | null
          porcentaje_ocupacion: number | null
          total_comensales: number | null
          total_reservas: number | null
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
          sala: string | null
          telefono: string | null
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
    }
    Functions: {
      bytea_to_text: { Args: { data: string }; Returns: string }
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
      text_to_bytea: { Args: { data: string }; Returns: string }
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
    }
    Enums: {
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
