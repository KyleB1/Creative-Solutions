# Stripe Payment Setup - Complete Guide

## 📋 Overview

Your Creative Web Solutions billing system is now configured with **Stripe** as the primary payment processor. This guide walks you through setup, testing, and deployment.

---

## 🚀 Quick Start (5 minutes)

### Step 1: Create Stripe Account

1. Go to **https://dashboard.stripe.com/register**
2. Sign up with your email
3. Complete verification (email confirmation)
4. Choose "Test mode" for development

### Step 2: Get API Keys

1. Go to **https://dashboard.stripe.com/apikeys**
2. Copy your **Publishable Key** (starts with `pk_test_`)
3. Copy your **Secret Key** (starts with `sk_test_`)
4. Keep these secure - never commit to version control!

### Step 3: Configure Environment

```bash
# Create .env file from example
cp .env.example .env

# Add your Stripe test keys to .env:
STRIPE_PUBLIC_KEY=pk_test_YOUR_KEY
STRIPE_SECRET_KEY=sk_test_YOUR_KEY
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET
```

### Step 4: Install Dependencies

```bash
npm install express stripe cors dotenv helmet express-rate-limit
```

### Step 5: Run Server

```bash
node server.js
```

You should see:
```
✓ Stripe connection successful
Server running on http://localhost:3000
Mode: TEST
```

---

## 📁 New Files Created

| File | Purpose |
|------|---------|
| **stripe-config.js** | Stripe SDK initialization, error handling, utilities |
| **billing-routes.js** | Express routes for payments, webhooks, refunds |
| **server.js** | Express.js server setup with Stripe integration |
| **.env.example** | Configuration template (updated with Stripe keys) |
| **billing-backend.js** | Updated with Stripe payment methods |
| **billing-frontend.js** | Updated with modern Stripe Payment Methods API |

---

## 🧪 Testing Payments

### Use Stripe Test Cards

In test mode, use these card numbers to test different scenarios:

```
✅ Successful Payment
  Card: 4242 4242 4242 4242
  Expiry: Any future date (12/26)
  CVV: Any 3 digits (123)

❌ Card Declined
  Card: 4000 0000 0000 0002
  Expiry: Any future date
  CVV: Any 3 digits

🔐 3D Secure Authentication
  Card: 4000 0025 0000 3155
  Expiry: Any future date
  CVV: Any 3 digits
  Click "Complete authentication" on success page

🏦 International Card
  Card: 4000 0000 0000 3220
  Expiry: Any future date
  CVV: Any 3 digits
```

### Test Payment Flow

1. **Create Payment Intent:**
   ```bash
   curl -X POST http://localhost:3000/api/billing/payment-intent \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer test_token" \
     -d '{
       "customerId": "cust_123",
       "amount": 99.99,
       "currency": "USD",
       "description": "Test payment"
     }'
   ```

2. **Response:**
   ```json
   {
     "clientSecret": "pi_xxx_secret_xxx",
     "paymentIntentId": "pi_xxx",
     "amount": 99.99,
     "currency": "USD"
   }
   ```

3. **Process Charge:**
   ```bash
   curl -X POST http://localhost:3000/api/billing/charge \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer test_token" \
     -d '{
       "customerId": "cust_123",
       "paymentMethodId": "pm_test_123",
       "amount": 99.99,
       "currency": "USD",
       "idempotencyKey": "unique_key_here",
       "email": "customer@example.com"
     }'
   ```

---

## 🔧 Frontend Integration

### HTML Form Example

```html
<form id="payment-form">
  <h2>Pay with Stripe</h2>
  
  <!-- Stripe card input (payment processor handles it securely) -->
  <div id="card-element"></div>
  <div id="card-errors"></div>
  
  <!-- Additional fields (optional) -->
  <input type="text" id="paymentName" placeholder="Name" />
  <input type="email" id="paymentEmail" placeholder="Email" />
  <input type="number" id="amount" placeholder="Amount" min="0.01" step="0.01" />
  
  <button type="submit">Pay Now</button>
</form>

<script src="https://js.stripe.com/v3/"></script>
<script src="billing-frontend.js"></script>
<script>
  // Initialize
  BillingClient.init('stripe', 'pk_test_YOUR_PUBLIC_KEY');
  BillingClient.createStripeForm();
  
  // Handle payment
  document.getElementById('payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const result = await BillingClient.processPayment(
      parseFloat(document.getElementById('amount').value) * 100, // Convert to cents
      'USD',
      'customer_id_here'
    );
    
    if (result.success) {
      alert('Payment successful!');
      console.log('Receipt:', result.receiptUrl);
    } else {
      alert('Payment failed: ' + result.error);
    }
  });
</script>
```

---

## 🪝 Webhook Setup

Stripe webhooks notify your server of payment events. To set up:

1. Go to **https://dashboard.stripe.com/webhooks**
2. Click **"Add endpoint"**
3. Set URL to: `https://yourdomain.com/api/billing/webhook`
4. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
5. Copy **Signing Secret** (starts with `whsec_`)
6. Add to `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET
   ```

### Webhook Events Handled

| Event | Handler | Action |
|-------|---------|--------|
| `payment_intent.succeeded` | `handlePaymentSucceeded()` | Mark payment as completed |
| `payment_intent.payment_failed` | `handlePaymentFailed()` | Mark payment as failed |
| `charge.refunded` | `handleChargeRefunded()` | Process refund |

---

## 💳 Payment Methods Supported

### By Default (Stripe)
- ✅ Credit Cards (Visa, Mastercard, Amex, Discover)
- ✅ Debit Cards
- ✅ Google Pay / Apple Pay
- ✅ Link (US only, faster checkout)

### Optional (via Stripe)
- 📱 International Wallets (iDEAL, Bancontact, EPS, Giropay, etc.)
- 🏦 Bank Transfers (ACH in US, SEPA in EU)
- 💰 Buy Now Pay Later (AfterPay, Klarna, etc.)

---

## 🔐 Security Checklist

- ✅ **Never store raw card data** - Stripe handles it
- ✅ **Use HTTPS only** - In production
- ✅ **Encrypt sensitive fields** - AES-256-GCM
- ✅ **Idempotency keys** - Prevent duplicate charges
- ✅ **Rate limiting** - 5 attempts per 15 min
- ✅ **Audit logging** - All operations tracked
- ✅ **PCI DSS compliant** - Payment processing handled by Stripe

---

## 📊 Database Integration

The billing system integrates with your database schema:

### Tables Used
- `payments` - Transaction records
- `payment_methods` - Stored payment methods
- `audit_logs` - Security audit trail

### Sample Query to View Payments

```sql
-- SQL Server
SELECT 
  payment_id,
  customer_id,
  amount,
  currency,
  status,
  processed_at,
  transaction_reference
FROM dbo.payments
WHERE customer_id = 'cust_123'
ORDER BY processed_at DESC;

-- PostgreSQL
SELECT 
  payment_id,
  customer_id,
  amount,
  currency,
  status,
  processed_at,
  transaction_reference
FROM payments
WHERE customer_id = 'cust_123'
ORDER BY processed_at DESC;
```

---

## 🚀 Moving to Production

### 1. Get Live Keys

1. Complete Stripe verification (5-10 minutes)
2. Go to **https://dashboard.stripe.com/account/onboarding/welcome**
3. Follow verification steps
4. Once approved, go to **API Keys** and reveal**Live Keys**
5. Copy `sk_live_...` and `pk_live_...`

### 2. Update Environment

```bash
# In .env (or environment variables)
NODE_ENV=production
STRIPE_SECRET_KEY_LIVE=sk_live_YOUR_LIVE_SECRET
STRIPE_PUBLIC_KEY_LIVE=pk_live_YOUR_LIVE_PUBLIC
STRIPE_WEBHOOK_SECRET_LIVE=whsec_live_YOUR_LIVE_SECRET
```

### 3. Enable HTTPS

```javascript
// server.js with HTTPS
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('/path/to/private.key'),
  cert: fs.readFileSync('/path/to/certificate.crt')
};

https.createServer(options, app).listen(443);
```

### 4. Deploy

```bash
# Build and deploy your application
npm run build
npm start  # in production
```

### 5. Test Live Payments

Use **real credit cards** (yours) with small amounts:
- Visa: 4242 4242 4242 4242 (real card flow test)
- Mastercard: 5555 5555 5555 4444

⚠️ **Only use your own cards for testing!**

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Stripe connection failed" | Check API keys in `.env`, ensure they're from correct environment (test/live) |
| "Invalid API Key" | Verify key format (`sk_test_` or `sk_live_`) and that it's the Secret Key, not Public Key |
| "Card declined" | Use test card `4000 0000 0000 0002` for decline testing. In production, check with customer's bank |
| "Webhook not received" | Verify signing secret is correct, ensure production URL is https://, check firewall |
| "Payment intent not found" | Ensure payment intent ID exists in Stripe dashboard (https://dashboard.stripe.com/payments) |
| "Rate limit exceeded" | Wait 15 minutes or deploy with higher `RATE_LIMIT_PAYMENTS` setting |

---

## 📚 Additional Resources

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Payment Intents Guide](https://stripe.com/docs/payments/payment-intents)
- [Testing Guide](https://stripe.com/docs/testing)
- [Webhooks Documentation](https://stripe.com/docs/webhooks)
- [Error Codes](https://stripe.com/docs/error-codes)

---

## 🆘 Support

For issues with:
- **Stripe API**: https://support.stripe.com
- **Your implementation**: Check logs in `./logs/` or console output
- **PCI Compliance**: See [BILLING_SECURITY.md](BILLING_SECURITY.md)

---

**Status:** ✅ Ready for Use  
**Test Mode:** Safe for development  
**Production Ready:** After Stripe verification  
**Last Updated:** March 2026
