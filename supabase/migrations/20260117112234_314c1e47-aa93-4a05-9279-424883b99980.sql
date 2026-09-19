-- Recrear la vista para que lea directamente de reservas en tiempo real
DROP VIEW IF EXISTS vista_ocupacion_hoy;

CREATE VIEW vista_ocupacion_hoy AS
SELECT 
    e.id AS espacio_id,
    e.nombre AS espacio_nombre,
    e.capacidad_maxima,
    COALESCE(COUNT(r.id), 0)::integer AS total_reservas,
    COALESCE(SUM(r.numero_comensales), 0)::integer AS total_comensales,
    CASE 
        WHEN e.capacidad_maxima > 0 
        THEN ROUND(COALESCE(SUM(r.numero_comensales), 0)::numeric / e.capacidad_maxima::numeric * 100, 0)
        ELSE 0
    END AS porcentaje_ocupacion
FROM espacios_reserva e
LEFT JOIN reservas r ON r.sala_id = e.id 
    AND r.fecha = CURRENT_DATE 
    AND r.estado != 'cancelada'
WHERE e.activa = true
GROUP BY e.id, e.nombre, e.capacidad_maxima;