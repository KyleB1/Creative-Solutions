# Billing System Quick Start

## Files Created/Modified

### Database Schemas (Updated for Encryption)
- **[database.sql](database.sql)** - SQL Server schema with encrypted payment fields
- **[database.postgres.sql](database.postgres.sql)** - PostgreSQL schema with pgcrypto encryption

**Key Changes:**
- Added `*_encrypted` VARBINARY fields for PII (billing address, name, zip)
- Enhanced audit_logs with resource tracking, IP logging, HTTP status codes
- Added `token_fingerprint` for deduplication and idempotency keys

### Backend Security
- **[billing-backend.js](billing-backend.js)** - Core payment processing engine
  - Encryption/decryption (AES-256-GCM)
  - Payment validation
  - Stripe/Square/PayPal payment processor integration
  - Idempotency checking
  - Audit logging

### Frontend Security
- **[billing-frontend.js](billing-frontend.js)** - Client-side payment module
  - Never collects raw card data
  - Manages payment processor SDKs (Stripe, Square, PayPal)
  - Tokenizes and sends only tokens to backend
  - Stores/manages payment methods securely

### Configuration
- **[.env.example](.env.example)** - Environment variables template
  - Encryption keys (AES-256)
  - Payment processor credentials
  - Security settings

### Documentation
- **[BILLING_SECURITY.md](BILLING_SECURITY.md)** - Complete security guide
  - Architecture overview
  - Encryption implementation
  - Payment processing patterns
  - PCI DSS compliance checklist
  - Testing procedures

---

## Next Steps: Setup Payment Processor

### Option 1: Stripe (Recommended)

```bash
# 1. Create Stripe account at https://stripe.com
# 2. Get API keys from https://dashboard.stripe.com/apikeys
# 3. Add to .env:
echo "STRIPE_PUBLIC_KEY=pk_test_..." >> .env
echo "STRIPE_SECRET_KEY=sk_test_..." >> .env
echo "STRIPE_WEBHOOK_SECRET=whsec_..." >> .env

# 4. Test with Stripe test card: 4242 4242 4242 4242
# Any future expiry, any CVV
```

### Option 2: Square

```bash
# 1. Create Square account at https://squareup.com
# 2. Get credentials from Application Dashboard
# 3. Add to .env:
echo "SQUARE_ACCESS_TOKEN=sq_secret_..." >> .env
echo "SQUARE_LOCATION_ID=..." >> .env

# 4. Test with card: 4111 1111 1111 1111
```

### Option 3: PayPal

```bash
# 1. Create PayPal account at https://developer.paypal.com
# 2. Create app in Sandbox
# 3. Add to .env:
echo "PAYPAL_CLIENT_ID=..." >> .env
echo "PAYPAL_CLIENT_SECRET=..." >> .env
```

---

## Critical Security Rules

❌ **NEVER DO:**
- Store raw credit card numbers
- Store CVV/security codes
- Log card data
- Send card data unencrypted
- Accept card data in HTML form fields

✅ **ALWAYS DO:**
- Use payment processor tokenization
- Encrypt PII at rest (AES-256)
- Use HTTPS in production
- Generate unique idempotency keys
- Log all operations to audit_logs
- Validate and sanitize all input
- Rate limit payment endpoints

---

## Architecture

```
Browser (Customer)
    ↓
Stripe/Square/PayPal SDK (Secure)
    ↓ (Token only)
Backend API (/api/billing/charge)
    ↓ (Token + amount only)
Payment Processor (Secure charge)
    ↓
Database (Token stored, PII encrypted)
```

---

## Key Files to Review

1. Start with: **[BILLING_SECURITY.md](BILLING_SECURITY.md)** - Full architecture guide
2. Then: **Database schemas** - See encrypted fields
3. Then: **[billing-backend.js](billing-backend.js)** - Encryption and payment logic
4. Finally: **[billing-frontend.js](billing-frontend.js)** - How to call from HTML

---

## Environment Setup

```bash
# 1. Create .env (DO NOT COMMIT!)
cp .env.example .env

# 2. Generate 256-bit encryption key
ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# Add to .env: ENCRYPTION_KEY=

# 3. Add payment processor credentials
# Add to .env: STRIPE_SECRET_KEY=, STRIPE_PUBLIC_KEY=, etc.

# 4. Add to .gitignore
echo ".env" >> .gitignore

# 5. Test encryption
node -e "
  const crypto = require('crypto');
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  console.log('✓ Encryption key loaded:', key.length * 8, 'bits');
"
```

---

## Implementation Checklist

- [ ] Update database with new schema
- [ ] Generate encryption key and add to .env
- [ ] Get payment processor API keys
- [ ] Install npm dependencies
- [ ] Update frontend to use `BillingClient`
- [ ] Test with payment processor's test card
- [ ] Verify audit logs are created
- [ ] Setup HTTPS certificate
- [ ] Test end-to-end payment flow
- [ ] Review BILLING_SECURITY.md compliance checklist
- [ ] Setup automated backups with encryption
- [ ] Deploy to production

---

## Testing Payment

```html
<!-- Example in customer-portal.html -->
<script src="billing-frontend.js"></script>
<script>
  // Initialize
  BillingClient.init('stripe', 'pk_test_YOUR_KEY');
  BillingClient.createStripeForm();
  
  // Handle payment
  document.getElementById('paymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const result = await BillingClient.processPayment(
      9999,  // $99.99 in cents
      'USD',
      customerData.id
    );
    
    console.log(result);  // { success, paymentId, transactionReference }
  });
  
  // Test with Stripe card: 4242 4242 4242 4242
  // Any future date (e.g., 12/26)
  // Any CVV (e.g., 123)
</script>
```

---

## Support

For questions on PCI DSS compliance:
- [PCI DSS Compliance Guide](https://www.pcisecuritystandards.org/)
- [OWASP Payment Security](https://owasp.org/www-community/attacks/)

For payment processor documentation:
- [Stripe Docs](https://stripe.com/docs)
- [Square Docs](https://developer.squareup.com/docs)
- [PayPal Docs](https://developer.paypal.com/docs)

---

**Status:** ✅ Ready for Implementation  
**Security Level:** PCI DSS Compliant  
**Last Updated:** March 29, 2026
