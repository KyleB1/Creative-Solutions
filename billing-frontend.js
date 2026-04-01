/**
 * billing-frontend.js - Secure client-side payment handling
 * 
 * CRITICAL: This module NEVER handles raw card data.
 * All card data is collected by payment processor's SDK (Stripe, Square, PayPal)
 * and tokenized. Only tokens are sent to your backend.
 * 
 * Flow:
 * 1. User enters card details in payment processor's hosted form or secure iframe
 * 2. Payment processor tokenizes the card
 * 3. Frontend sends ONLY the token to backend
 * 4. Backend charges the token via processor's API
 * 5. Never store raw card data in browser, localStorage, or anywhere
 */

(function () {
  const BillingClient = {
    config: {
      apiBase: '/api/billing',
      provider: 'stripe', // Options: 'stripe', 'square', 'paypal'
      publicKey: null
    },

    /**
     * Initialize billing module with provider
     * Must be called before processing payments
     */
    init: function (providerName, publicKey) {
      this.config.provider = providerName;
      this.config.publicKey = publicKey;

      // Load payment processor SDK
      switch (providerName) {
        case 'stripe':
          this.loadStripeSDK();
          break;
        case 'square':
          this.loadSquareSDK();
          break;
        case 'paypal':
          this.loadPayPalSDK();
          break;
        default:
          console.error('Unknown payment provider:', providerName);
      }
    },

    /**
     * Load Stripe.js SDK
     */
    loadStripeSDK: function () {
      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.onload = () => {
        window.stripe = Stripe(this.config.publicKey);
        window.stripeElements = window.stripe.elements();
      };
      document.head.appendChild(script);
    },

    /**
     * Load Square Web Payments SDK
     */
    loadSquareSDK: function () {
      const script = document.createElement('script');
      script.src = 'https://web.squarecdn.com/v1/square.js';
      script.onload = () => {
        window.Square.payments(this.config.publicKey)
          .then(payments => {
            window.squarePayments = payments;
          })
          .catch(error => {
            console.error('Square SDK load failed:', error);
          });
      };
      document.head.appendChild(script);
    },

    /**
     * Load PayPal SDK
     */
    loadPayPalSDK: function () {
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${this.config.publicKey}`;
      document.head.appendChild(script);
    },

    /**
     * Create Stripe payment form in a container
     * Container should have id="payment-form-container"
     */
    createStripeForm: function () {
      const stripe = window.stripe;
      const elements = window.stripeElements;

      if (!stripe || !elements) {
        console.error('Stripe SDK not loaded');
        return;
      }

      const cardElement = elements.create('card', {
        style: {
          base: {
            fontSize: '16px',
            color: '#424770',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          },
          invalid: {
            color: '#9e2146'
          }
        }
      });

      const container = document.getElementById('stripe-card-element');
      if (container) {
        cardElement.mount(container);
        window.stripeCardElement = cardElement;
      }

      // Handle real-time validation errors
      cardElement.on('change', (e) => {
        const errorMessage = document.getElementById('stripe-card-errors');
        if (errorMessage) {
          if (e.error) {
            errorMessage.textContent = e.error.message;
          } else {
            errorMessage.textContent = '';
          }
        }
      });
    },

    /**
     * Create Square payment form
     */
    createSquareForm: function () {
      // TODO: Implement Square Web Payments Form
      // Use Web Payments Form or Card Payment Elements
    },

    /**
     * Create PayPal payment form
     */
    createPayPalForm: function () {
      // TODO: Implement PayPal Buttons
    },

    /**
     * Process payment - handles tokenization and backend call
     * @param {string} amount - Amount in cents/smallest unit
     * @param {string} currency - ISO 4217 currency code
     * @param {string} customerId - Your customer ID
     */
    processPayment: async function (amount, currency, customerId) {
      const idempotencyKey = this.generateIdempotencyKey();

      try {
        let token;

        // Get token from payment processor
        switch (this.config.provider) {
          case 'stripe':
            token = await this.getStripeToken();
            break;
          case 'square':
            token = await this.getSquareToken();
            break;
          case 'paypal':
            // PayPal handles payment separately
            return await this.processPayPalPayment(amount, currency, customerId);
          default:
            throw new Error('Unknown payment provider');
        }

        if (!token) {
          throw new Error('Failed to tokenize payment method');
        }

        // Send token to backend
        // IMPORTANT: Backend NEVER receives raw card data, only token
        const response = await fetch(`${this.config.apiBase}/charge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.getSessionToken()}`
          },
          body: JSON.stringify({
            amount,
            currency,
            customerId,
            paymentMethodId: token, // Only send token, never raw card data
            idempotencyKey // Prevent duplicate charges
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Payment processing failed');
        }

        return {
          success: true,
          paymentId: result.paymentId,
          transactionReference: result.transactionReference,
          receiptUrl: result.receiptUrl
        };
      } catch (error) {
        console.error('Payment error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    /**
     * Get Stripe payment method (modern API - recommended)
     * Creates a PaymentMethod object which is used with PaymentIntents
     */
    getStripeToken: async function () {
      const stripe = window.stripe;
      const cardElement = window.stripeCardElement;

      if (!stripe || !cardElement) {
        throw new Error('Stripe not initialized');
      }

      // Create payment method from card element (modern API)
      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: {
          name: document.getElementById('paymentName')?.value || undefined,
          email: document.getElementById('paymentEmail')?.value || undefined,
          address: {
            line1: document.getElementById('paymentAddress')?.value || undefined,
            city: document.getElementById('paymentCity')?.value || undefined,
            state: document.getElementById('paymentState')?.value || undefined,
            postal_code: document.getElementById('paymentZip')?.value || undefined,
            country: 'US'
          }
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!paymentMethod) {
        throw new Error('Failed to create payment method');
      }

      // Return payment method ID (format: pm_xxxxx) not deprecated token
      return paymentMethod.id;
    },

    /**
     * Get Square token
     */
    getSquareToken: async function () {
      // TODO: Implement Square tokenization
      throw new Error('Square tokenization not yet implemented');
    },

    /**
     * Process PayPal payment
     */
    processPayPalPayment: async function (amount, currency, customerId) {
      // TODO: Implement PayPal payment
      throw new Error('PayPal integration not yet implemented');
    },

    /**
     * Store payment method for future use (without storing card data)
     * @param {boolean} setAsDefault - Make this the default payment method
     */
    storePaymentMethod: async function (setAsDefault = false) {
      try {
        let token;

        switch (this.config.provider) {
          case 'stripe':
            token = await this.getStripeToken();
            break;
          case 'square':
            token = await this.getSquareToken();
            break;
          default:
            throw new Error('Unknown payment provider');
        }

        const response = await fetch(`${this.config.apiBase}/payment-methods`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.getSessionToken()}`
          },
          body: JSON.stringify({
            paymentMethodId: token, // Only send tokenized payment method ID
            setAsDefault
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Failed to store payment method');
        }

        return {
          success: true,
          paymentMethodId: result.paymentMethodId,
          lastFour: result.lastFour,
          brand: result.brand
        };
      } catch (error) {
        console.error('Store payment method error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    /**
     * Process payment using stored payment method
     */
    processStoredPayment: async function (amount, currency, paymentMethodId, customerId) {
      const idempotencyKey = this.generateIdempotencyKey();

      try {
        const response = await fetch(`${this.config.apiBase}/charge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.getSessionToken()}`
          },
          body: JSON.stringify({
            amount,
            currency,
            customerId,
            paymentMethodId, // Use stored payment method
            idempotencyKey
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Payment failed');
        }

        return {
          success: true,
          paymentId: result.paymentId,
          transactionReference: result.transactionReference
        };
      } catch (error) {
        console.error('Stored payment error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    /**
     * Get list of stored payment methods for customer
     */
    getPaymentMethods: async function () {
      try {
        const response = await fetch(`${this.config.apiBase}/payment-methods`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.getSessionToken()}`
          }
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Failed to fetch payment methods');
        }

        return {
          success: true,
          paymentMethods: result.paymentMethods.map(pm => ({
            id: pm.id,
            brand: pm.brand,
            lastFour: pm.lastFour,
            expiry: pm.expiry,
            isDefault: pm.isDefault,
            createdAt: pm.createdAt
          }))
        };
      } catch (error) {
        console.error('Error fetching payment methods:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    /**
     * Delete stored payment method
     */
    deletePaymentMethod: async function (paymentMethodId) {
      try {
        const response = await fetch(`${this.config.apiBase}/payment-methods/${paymentMethodId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.getSessionToken()}`
          }
        });

        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || 'Failed to delete payment method');
        }

        return { success: true };
      } catch (error) {
        console.error('Error deleting payment method:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    /**
     * Get payment history
     */
    getPaymentHistory: async function () {
      try {
        let customerId = null;
        try {
          const customer = window.SiteAuth && typeof window.SiteAuth.getCustomer === 'function'
            ? window.SiteAuth.getCustomer()
            : null;
          customerId = customer && customer.customerId ? customer.customerId : null;
        } catch {
          customerId = null;
        }

        const query = customerId ? `?customerId=${encodeURIComponent(customerId)}` : '';
        const response = await fetch(`${this.config.apiBase}/payments${query}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.getSessionToken()}`,
            ...(customerId ? { 'X-Customer-Id': customerId } : {})
          }
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Failed to fetch payment history');
        }

        return {
          success: true,
          payments: result.payments.map(p => ({
            id: p.id,
            amount: p.amount,
            currency: p.currency,
            status: p.status,
            date: p.date,
            transactionRef: p.transactionReference,
            method: p.method
          }))
        };
      } catch (error) {
        console.error('Error fetching payment history:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    /**
     * Generate unique idempotency key to prevent duplicate charges
     */
    generateIdempotencyKey: function () {
      return 'idempotency-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Get current session token from auth system
     */
    getSessionToken: function () {
      return null;
    },

    /**
     * CRITICAL SECURITY: Clear all sensitive data
     */
    clearSensitiveData: function () {
      // Clear any card element that might store data
      if (window.stripeCardElement) {
        window.stripeCardElement.clear();
      }

      // Ensure no card data in DOM
      const formInputs = document.querySelectorAll('input[type="text"], input[type="password"]');
      formInputs.forEach(input => {
        if (input.id && (input.id.includes('card') || input.id.includes('cvv'))) {
          input.value = '';
        }
      });
    }
  };

  // Export for global use
  if (typeof window !== 'undefined') {
    window.BillingClient = BillingClient;
  }

  // Also export for module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillingClient;
  }
})();
