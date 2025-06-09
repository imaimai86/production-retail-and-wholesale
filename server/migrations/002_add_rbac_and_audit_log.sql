-- Add role column to users table
ALTER TABLE users ADD COLUMN role VARCHAR(255) DEFAULT 'user' NOT NULL;

-- Create audit_log table
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(255) NOT NULL,
    entity VARCHAR(255),
    entity_id INTEGER,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Update existing admin user to super_admin
-- Assuming the user with id stored in ADMIN_TOKEN is the super admin
-- This part is tricky as we don't have direct access to ENV vars here.
-- For now, let's assume user with ID 1 is the super_admin if ADMIN_TOKEN is '1' or similar.
-- Or, we can skip this and handle it manually or in a later step.
-- For simplicity in this subtask, we'll add a placeholder comment.
-- TODO: Manually update the first user or the user corresponding to ADMIN_TOKEN to 'super_admin'
