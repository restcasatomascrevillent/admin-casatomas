-- Allow admin as base_role in presets
ALTER TABLE user_role_presets DROP CONSTRAINT user_role_presets_base_role_check;
ALTER TABLE user_role_presets ADD CONSTRAINT user_role_presets_base_role_check CHECK (base_role = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role]));

-- Fix the "Admin" preset to have correct base_role
UPDATE user_role_presets SET base_role = 'admin' WHERE name = 'Admin' AND base_role = 'staff';

-- Fix pablo's role to admin (was incorrectly set as staff via preset)
UPDATE user_roles SET role = 'admin' WHERE user_id = '46a07ab7-9698-4230-9d7b-00d56703842f';