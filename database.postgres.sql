-- Secure modern database schema for Creative Web Solutions
-- PostgreSQL version.
-- Run with psql example:
-- psql -h localhost -U postgres -d creative_web_solutions -f database.postgres.sql
-- Optional one-time database creation:
-- createdb -h localhost -U postgres creative_web_solutions

-- CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Drop objects in dependency order so this script can be re-run safely.
DROP VIEW IF EXISTS customer_portal_summary;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS payment_methods;
DROP TABLE IF EXISTS support_tickets;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS customers;

-- Store users with secure password hashing and email uniqueness.
CREATE TABLE customers (
    customer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    company_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active',
    plan_name TEXT NOT NULL DEFAULT 'growth',
    role_name TEXT NOT NULL DEFAULT 'customer',
    metadata JSONB NOT NULL DEFAULT CAST('{}' AS JSONB)
);

-- Store application sessions and tokens securely.
CREATE TABLE sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    user_agent TEXT,
    ip_address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_sessions_customer_id ON sessions(customer_id);

-- Track customer projects in the portal.
CREATE TABLE projects (
    project_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    budget NUMERIC(12, 2) DEFAULT 0,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT CAST('{}' AS JSONB)
);
CREATE INDEX idx_projects_customer_id ON projects(customer_id);

-- Store support tickets linked to each customer.
CREATE TABLE support_tickets (
    ticket_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_support_tickets_customer_id ON support_tickets(customer_id);

-- Store tokenized payment methods without raw card data.
CREATE TABLE payment_methods (
    payment_method_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    card_brand TEXT,
    last_four TEXT,
    expiry_month SMALLINT,
    expiry_year SMALLINT,
    billing_name TEXT,
    billing_address TEXT,
    token TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT CAST('{}' AS JSONB)
);
CREATE INDEX idx_payment_methods_customer_id ON payment_methods(customer_id);

CREATE TABLE payments (
    payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    payment_method_id UUID REFERENCES payment_methods(payment_method_id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'completed',
    transaction_reference TEXT NOT NULL UNIQUE,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT CAST('{}' AS JSONB)
);
CREATE INDEX idx_payments_customer_id ON payments(customer_id);

-- Audit log for security and change tracking.
CREATE TABLE audit_logs (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(customer_id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL DEFAULT CAST('{}' AS JSONB),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- View for customer-specific portal summary.
CREATE VIEW customer_portal_summary AS
SELECT
    c.customer_id,
    c.email,
    c.full_name,
    c.plan_name,
    c.status,
    c.role_name,
    c.last_login_at,
    COUNT(DISTINCT p.project_id) AS active_projects,
    COUNT(DISTINCT t.ticket_id) FILTER (WHERE t.status <> 'closed') AS open_tickets,
    COALESCE(SUM(p.budget), 0)::NUMERIC(12, 2) AS total_budget
FROM customers c
LEFT JOIN projects p ON p.customer_id = c.customer_id
LEFT JOIN support_tickets t ON t.customer_id = c.customer_id
GROUP BY c.customer_id, c.email, c.full_name, c.plan_name, c.status, c.role_name, c.last_login_at;

-- Example admin accounts.
-- Replace placeholder hashes with strong bcrypt hashes from your backend.

INSERT INTO customers (email, password_hash, full_name, company_name, status, plan_name, role_name)
VALUES
    ('admin@creativewebsolutions.com', crypt('AdminPassword123!', gen_salt('bf', 12)), 'Admin User', 'Creative Web Solutions', 'active', 'enterprise', 'admin'),
    ('kyle.creativesolutions@gmail.com', crypt('AdminPassword123!', gen_salt('bf', 12)), 'Kyle Creative', 'Creative Web Solutions', 'active', 'enterprise', 'system_admin');

-- Notes:
-- 1) Always hash passwords using a strong algorithm like bcrypt, argon2, or scrypt.
-- 2) Never store raw passwords in the database.
-- 3) Use HTTPS + secure cookies for session tokens on the client.
-- 4) Apply row-level security in production for customer isolation.