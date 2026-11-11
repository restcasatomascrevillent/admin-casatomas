-- Vuelta atrás de supabase/migrations/20261124110000_carta_bebidas_web.sql
--
-- AVISO: revertir antes el panel (el interruptor de Gestor web › Carta › Bebidas escribe esta columna)
-- y la web (la lee). Sin la columna, la web que lea `select=*` vuelve a enseñar las bebidas si su código
-- trata la ausencia como «encendida»; la versión que trae esta migración la trata como «apagada».
-- Se pierde el valor guardado del interruptor.

alter table public.configuracion_web drop column if exists mostrar_carta_bebidas_casa_tomas;
