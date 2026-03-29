-- Secure modern database schema for Creative Web Solutions
-- SQL Server (T-SQL) version.
-- Run with sqlcmd example:
-- sqlcmd -S localhost -d CreativeWebSolutions -E -i database.sql
-- If using SQL authentication instead of Windows auth:
-- sqlcmd -S localhost -d CreativeWebSolutions -U your_user -P your_password -i database.sql

SET NOCOUNT ON;
GO

-- Drop objects in dependency order so this script can be re-run safely.
IF OBJECT_ID('dbo.customer_portal_summary', 'V') IS NOT NULL
    DROP VIEW dbo.customer_portal_summary;
GO

IF OBJECT_ID('dbo.audit_logs', 'U') IS NOT NULL DROP TABLE dbo.audit_logs;
IF OBJECT_ID('dbo.payments', 'U') IS NOT NULL DROP TABLE dbo.payments;
IF OBJECT_ID('dbo.payment_methods', 'U') IS NOT NULL DROP TABLE dbo.payment_methods;
IF OBJECT_ID('dbo.support_tickets', 'U') IS NOT NULL DROP TABLE dbo.support_tickets;
IF OBJECT_ID('dbo.projects', 'U') IS NOT NULL DROP TABLE dbo.projects;
IF OBJECT_ID('dbo.sessions', 'U') IS NOT NULL DROP TABLE dbo.sessions;
IF OBJECT_ID('dbo.customers', 'U') IS NOT NULL DROP TABLE dbo.customers;
GO

-- Store users with secure password hashing and email uniqueness.
CREATE TABLE dbo.customers (
    customer_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_customers PRIMARY KEY DEFAULT NEWID(),
    email NVARCHAR(320) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    full_name NVARCHAR(200) NOT NULL,
    company_name NVARCHAR(200) NULL,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_customers_created_at DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_customers_updated_at DEFAULT SYSDATETIMEOFFSET(),
    last_login_at DATETIMEOFFSET(0) NULL,
    status NVARCHAR(30) NOT NULL CONSTRAINT DF_customers_status DEFAULT 'active',
    plan_name NVARCHAR(30) NOT NULL CONSTRAINT DF_customers_plan_name DEFAULT 'growth',
    role_name NVARCHAR(30) NOT NULL CONSTRAINT DF_customers_role_name DEFAULT 'customer',
    metadata NVARCHAR(MAX) NOT NULL CONSTRAINT DF_customers_metadata DEFAULT '{}',
    CONSTRAINT UQ_customers_email UNIQUE (email),
    CONSTRAINT CK_customers_metadata_json CHECK (ISJSON(metadata) = 1)
);
GO

-- Store application sessions and tokens securely.
CREATE TABLE dbo.sessions (
    session_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sessions PRIMARY KEY DEFAULT NEWID(),
    customer_id UNIQUEIDENTIFIER NOT NULL,
    token_hash NVARCHAR(255) NOT NULL,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_sessions_created_at DEFAULT SYSDATETIMEOFFSET(),
    expires_at DATETIMEOFFSET(0) NOT NULL,
    revoked_at DATETIMEOFFSET(0) NULL,
    user_agent NVARCHAR(500) NULL,
    ip_address NVARCHAR(64) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_sessions_is_active DEFAULT 1,
    CONSTRAINT FK_sessions_customers FOREIGN KEY (customer_id)
        REFERENCES dbo.customers(customer_id) ON DELETE CASCADE
);
GO

CREATE INDEX idx_sessions_customer_id ON dbo.sessions(customer_id);
GO

-- Track customer projects in the portal.
CREATE TABLE dbo.projects (
    project_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_projects PRIMARY KEY DEFAULT NEWID(),
    customer_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(200) NOT NULL,
    status NVARCHAR(30) NOT NULL CONSTRAINT DF_projects_status DEFAULT 'active',
    budget DECIMAL(12, 2) NOT NULL CONSTRAINT DF_projects_budget DEFAULT 0,
    starts_at DATETIMEOFFSET(0) NULL,
    ends_at DATETIMEOFFSET(0) NULL,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_projects_created_at DEFAULT SYSDATETIMEOFFSET(),
    metadata NVARCHAR(MAX) NOT NULL CONSTRAINT DF_projects_metadata DEFAULT '{}',
    CONSTRAINT CK_projects_metadata_json CHECK (ISJSON(metadata) = 1),
    CONSTRAINT FK_projects_customers FOREIGN KEY (customer_id)
        REFERENCES dbo.customers(customer_id) ON DELETE CASCADE
);
GO

CREATE INDEX idx_projects_customer_id ON dbo.projects(customer_id);
GO

-- Store support tickets linked to each customer.
CREATE TABLE dbo.support_tickets (
    ticket_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_support_tickets PRIMARY KEY DEFAULT NEWID(),
    customer_id UNIQUEIDENTIFIER NOT NULL,
    subject NVARCHAR(200) NOT NULL,
    message NVARCHAR(MAX) NULL,
    status NVARCHAR(30) NOT NULL CONSTRAINT DF_support_tickets_status DEFAULT 'open',
    priority NVARCHAR(30) NOT NULL CONSTRAINT DF_support_tickets_priority DEFAULT 'normal',
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_support_tickets_created_at DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_support_tickets_updated_at DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT FK_support_tickets_customers FOREIGN KEY (customer_id)
        REFERENCES dbo.customers(customer_id) ON DELETE CASCADE
);
GO

CREATE INDEX idx_support_tickets_customer_id ON dbo.support_tickets(customer_id);
GO

-- Store tokenized payment methods without raw card data.
CREATE TABLE dbo.payment_methods (
    payment_method_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_payment_methods PRIMARY KEY DEFAULT NEWID(),
    customer_id UNIQUEIDENTIFIER NOT NULL,
    provider NVARCHAR(100) NOT NULL,
    card_brand NVARCHAR(40) NULL,
    last_four CHAR(4) NULL,
    expiry_month TINYINT NULL,
    expiry_year SMALLINT NULL,
    billing_name NVARCHAR(200) NULL,
    billing_address NVARCHAR(500) NULL,
    token NVARCHAR(255) NOT NULL,
    is_default BIT NOT NULL CONSTRAINT DF_payment_methods_is_default DEFAULT 0,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_payment_methods_created_at DEFAULT SYSDATETIMEOFFSET(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_payment_methods_updated_at DEFAULT SYSDATETIMEOFFSET(),
    metadata NVARCHAR(MAX) NOT NULL CONSTRAINT DF_payment_methods_metadata DEFAULT '{}',
    CONSTRAINT CK_payment_methods_metadata_json CHECK (ISJSON(metadata) = 1),
    CONSTRAINT FK_payment_methods_customers FOREIGN KEY (customer_id)
        REFERENCES dbo.customers(customer_id) ON DELETE CASCADE
);
GO

CREATE INDEX idx_payment_methods_customer_id ON dbo.payment_methods(customer_id);
GO

CREATE TABLE dbo.payments (
    payment_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_payments PRIMARY KEY DEFAULT NEWID(),
    customer_id UNIQUEIDENTIFIER NOT NULL,
    payment_method_id UNIQUEIDENTIFIER NULL,
    amount DECIMAL(12, 2) NOT NULL,
    currency CHAR(3) NOT NULL CONSTRAINT DF_payments_currency DEFAULT 'USD',
    status NVARCHAR(30) NOT NULL CONSTRAINT DF_payments_status DEFAULT 'completed',
    transaction_reference NVARCHAR(120) NOT NULL,
    processed_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_payments_processed_at DEFAULT SYSDATETIMEOFFSET(),
    metadata NVARCHAR(MAX) NOT NULL CONSTRAINT DF_payments_metadata DEFAULT '{}',
    CONSTRAINT UQ_payments_transaction_reference UNIQUE (transaction_reference),
    CONSTRAINT CK_payments_metadata_json CHECK (ISJSON(metadata) = 1),
    CONSTRAINT FK_payments_customers FOREIGN KEY (customer_id)
        REFERENCES dbo.customers(customer_id) ON DELETE CASCADE,
    CONSTRAINT FK_payments_payment_methods FOREIGN KEY (payment_method_id)
        REFERENCES dbo.payment_methods(payment_method_id) ON DELETE SET NULL
);
GO

CREATE INDEX idx_payments_customer_id ON dbo.payments(customer_id);
GO

-- Audit log for security and change tracking.
CREATE TABLE dbo.audit_logs (
    audit_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_audit_logs PRIMARY KEY DEFAULT NEWID(),
    customer_id UNIQUEIDENTIFIER NULL,
    event_type NVARCHAR(100) NOT NULL,
    event_data NVARCHAR(MAX) NOT NULL CONSTRAINT DF_audit_logs_event_data DEFAULT '{}',
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT DF_audit_logs_created_at DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_audit_logs_event_data_json CHECK (ISJSON(event_data) = 1),
    CONSTRAINT FK_audit_logs_customers FOREIGN KEY (customer_id)
        REFERENCES dbo.customers(customer_id) ON DELETE SET NULL
);
GO

-- View for customer-specific portal summary.
CREATE VIEW dbo.customer_portal_summary
AS
SELECT
    c.customer_id,
    c.email,
    c.full_name,
    c.plan_name,
    c.status,
    c.role_name,
    c.last_login_at,
    COUNT(DISTINCT p.project_id) AS active_projects,
    SUM(CASE WHEN t.status <> 'closed' THEN 1 ELSE 0 END) AS open_tickets,
    COALESCE(SUM(p.budget), 0) AS total_budget
FROM dbo.customers AS c
LEFT JOIN dbo.projects AS p ON p.customer_id = c.customer_id
LEFT JOIN dbo.support_tickets AS t ON t.customer_id = c.customer_id
GROUP BY c.customer_id, c.email, c.full_name, c.plan_name, c.status, c.role_name, c.last_login_at;
GO

-- Example admin accounts.
-- Replace placeholder hashes with strong hashes produced by your backend.
INSERT INTO dbo.customers (email, password_hash, full_name, company_name, status, plan_name, role_name)
VALUES
    ('admin@creativewebsolutions.com', 'REPLACE_WITH_BCRYPT_HASH', 'Admin User', 'Creative Web Solutions', 'active', 'enterprise', 'admin'),
    ('kyle.creativesolutions@gmail.com', 'REPLACE_WITH_BCRYPT_HASH', 'Kyle Creative', 'Creative Web Solutions', 'active', 'enterprise', 'system_admin');
GO

-- Notes:
-- 1) Always hash passwords using a strong algorithm like bcrypt, argon2, or scrypt.
-- 2) Never store raw passwords in the database.
-- 3) Use HTTPS + secure cookies for session tokens on the client.
-- 4) Apply row-level security in production for customer isolation.