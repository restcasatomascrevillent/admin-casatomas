-- Idempotent index on reservas.telefono for phone lookups
-- Supports the .in('telefono', phoneVariants) queries used by
-- find_reservation, modify_reservation, and cancel_reservation.
-- Migration: cierre-sistema-vapi / T0.1 / A6
CREATE INDEX IF NOT EXISTS idx_reservas_telefono ON reservas (telefono);
