
-- Insert 100 reservas for today (2026-02-16): 50 mediodía + 50 noche
INSERT INTO reservas (nombre, telefono, email, fecha, hora, sala_id, numero_comensales, estado)
SELECT 
  (ARRAY['Carlos Ruiz','María González','Juan Pérez','Ana Martín','Pedro López','Laura Sánchez','Miguel Rodríguez','Isabel Fernández','Antonio García','Carmen Torres','Francisco Díaz','Lucía Moreno','Roberto Jiménez','Elena Navarro','José Ruiz','Teresa Vega','David Castro','Sara Ortiz','Manuel Delgado','Patricia Herrera','Alejandro Muñoz','Beatriz Romero','Daniel Álvarez','Cristina Molina','Fernando Serrano','Gloria Domínguez','Héctor Ramos','Irene Blanco','Jorge Suárez','Lorena Iglesias','Mario Vázquez','Natalia Crespo','Óscar Ortega','Paula Guerrero','Ramón Rubio','Silvia Medina','Tomás Marín','Verónica Gil','Adrián Jiménez','Blanca Caballero','César Peña','Diana Carrasco','Eduardo Herrero','Fátima Santana','Gonzalo Lozano','Helena Nieto','Iván Pascual','Julia Reyes','Kevin Calvo','Lidia Gallego','Marcos Prieto','Nuria Fuentes','Pablo Aguilar','Raquel León','Sergio Ibáñez','Tamara Montero','Víctor Cano','Yolanda Parra','Alberto Santos','Belén Cortés','Diego Mora','Eva Castillo','Guillermo Cruz','Inés Soler','Javier Vargas','Lourdes Arias','Nicolás Pereira','Olga Campos','Ricardo Vidal','Sandra Ferrer','Álvaro Rivas','Carolina Sanz','Emilio Rojas','Gemma Esteban','Hugo Bravo','Lucía Méndez','Mateo Cabrera','Noelia Franco','Raúl Giménez','Susana Lorenzo','Abel Duran','Berta Contreras','Claudio Merino','Dolores Vera','Ernesto Moya','Flora Benítez','Gaspar Salazar','Hortensia Cabezas','Ignacio Tejada','Jana Villanueva','Kiko Prado','Lara Acosta','Mauricio Velasco','Nerea Cordero','Octavio Ríos','Pilar Segura','Rodrigo Espinosa','Sonia Aranda','Unai Galindo','Valeria Puig'])[i] AS nombre,
  '6' || lpad((12345000 + i)::text, 8, '0') AS telefono,
  'test' || i || '@email.com' AS email,
  '2026-02-16'::date AS fecha,
  CASE 
    WHEN i <= 50 THEN 
      (ARRAY['12:30','13:00','13:30','14:00','14:30','15:00','15:30'])[1 + (i % 7)]::time
    ELSE 
      (ARRAY['19:30','20:00','20:30','21:00','21:30','22:00','22:30'])[1 + (i % 7)]::time
  END AS hora,
  CASE (i % 3)
    WHEN 0 THEN '5888d22a-f228-41f5-8a9d-c8b3ee255863'::uuid
    WHEN 1 THEN 'db8be4e2-2e67-4110-99b1-9e1d779514cc'::uuid
    ELSE '449cffc7-1189-4f3c-a0b3-b60b3442979d'::uuid
  END AS sala_id,
  2 + (i % 8) AS numero_comensales,
  (ARRAY['confirmada','confirmada','confirmada','pendiente'])[1 + (i % 4)] AS estado
FROM generate_series(1, 100) AS i;
