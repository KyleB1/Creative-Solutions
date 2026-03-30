#!/bin/bash
# stripe-verify.sh - Verify Stripe setup

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              STRIPE SETUP VERIFICATION SCRIPT                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js
echo "📦 Checking Node.js..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v)
  echo -e "${GREEN}✓${NC} Node.js installed: $NODE_VERSION"
else
  echo -e "${RED}✗${NC} Node.js not found. Install from https://nodejs.org/"
  exit 1
fi

# Check npm
echo ""
echo "📦 Checking npm..."
if command -v npm &> /dev/null; then
  NPM_VERSION=$(npm -v)
  echo -e "${GREEN}✓${NC} npm installed: $NPM_VERSION"
else
  echo -e "${RED}✗${NC} npm not found"
  exit 1
fi

# Check .env file
echo ""
echo "🔑 Checking environment configuration..."
if [ -f ".env" ]; then
  echo -e "${GREEN}✓${NC} .env file exists"
  
  # Check for Stripe keys
  if grep -q "STRIPE_SECRET_KEY=" .env; then
    SK=$(grep "STRIPE_SECRET_KEY=" .env | cut -d'=' -f2)
    if [ -n "$SK" ] && [ "$SK" != "sk_test_your_test_key_here" ]; then
      echo -e "${GREEN}✓${NC} STRIPE_SECRET_KEY configured"
    else
      echo -e "${YELLOW}⚠${NC}  STRIPE_SECRET_KEY not set or using placeholder"
    fi
  fi
  
  if grep -q "STRIPE_PUBLIC_KEY=" .env; then
    PK=$(grep "STRIPE_PUBLIC_KEY=" .env | cut -d'=' -f2)
    if [ -n "$PK" ] && [ "$PK" != "pk_test_your_test_key_here" ]; then
      echo -e "${GREEN}✓${NC} STRIPE_PUBLIC_KEY configured"
    else
      echo -e "${YELLOW}⚠${NC}  STRIPE_PUBLIC_KEY not set or using placeholder"
    fi
  fi
  
  # Check for encryption key
  if grep -q "ENCRYPTION_KEY=" .env; then
    EK=$(grep "ENCRYPTION_KEY=" .env | cut -d'=' -f2)
    if [ -n "$EK" ] && [ "$EK" != "your_64_character_hex_encryption_key_here_must_be_256_bit_aes" ]; then
      echo -e "${GREEN}✓${NC} ENCRYPTION_KEY configured"
    else
      echo -e "${YELLOW}⚠${NC}  ENCRYPTION_KEY not set"
    fi
  fi
else
  echo -e "${YELLOW}⚠${NC}  .env file not found"
  echo "    Run: cp .env.example .env"
fi

# Check package.json
echo ""
echo "📋 Checking dependencies..."
if [ -f "package.json" ]; then
  echo -e "${GREEN}✓${NC} package.json exists"
  
  if [ -d "node_modules" ]; then
    echo -e "${GREEN}✓${NC} node_modules directory exists"
    
    # Check for key dependencies
    if [ -d "node_modules/stripe" ]; then
      echo -e "${GREEN}✓${NC} stripe module installed"
    else
      echo -e "${YELLOW}⚠${NC}  stripe module not installed"
    fi
    
    if [ -d "node_modules/express" ]; then
      echo -e "${GREEN}✓${NC} express module installed"
    else
      echo -e "${YELLOW}⚠${NC}  express module not installed"
    fi
  else
    echo -e "${YELLOW}⚠${NC}  node_modules not found"
    echo "    Run: npm install"
  fi
else
  echo -e "${RED}✗${NC} package.json not found"
  exit 1
fi

# Check main files
echo ""
echo "📁 Checking source files..."
FILES=(
  "stripe-config.js"
  "billing-routes.js"
  "server.js"
  "billing-backend.js"
  "billing-frontend.js"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "${GREEN}✓${NC} $file"
  else
    echo -e "${RED}✗${NC} $file (missing)"
  fi
done

# Test Stripe connection
echo ""
echo "🔗 Testing Stripe connection..."
node -e "
  require('dotenv').config();
  const stripe = require('stripe');
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.log('\x1b[33m⚠\x1b[0m  STRIPE_SECRET_KEY not set in .env');
      process.exit(0);
    }
    
    const s = stripe(process.env.STRIPE_SECRET_KEY);
    s.apiKeys.list({ limit: 1 }, (err, keys) => {
      if (err) {
        console.log('\x1b[31m✗\x1b[0m  Stripe connection failed:', err.message);
        process.exit(1);
      } else {
        console.log('\x1b[32m✓\x1b[0m  Stripe connection successful');
        process.exit(0);
      }
    });
  } catch (e) {
    console.log('\x1b[31m✗\x1b[0m  Error:', e.message);
    process.exit(1);
  }
" 2>/dev/null || true

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                        CHECKOUT                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1. Update .env with your Stripe test keys:"
echo "   - Get from: https://dashboard.stripe.com/apikeys"
echo "   - Add STRIPE_SECRET_KEY and STRIPE_PUBLIC_KEY"
echo ""
echo "2. Install dependencies (if not done):"
echo "   npm install"
echo ""
echo "3. Start the server:"
echo "   npm start"
echo ""
echo "4. Test payment with card: 4242 4242 4242 4242"
echo ""
echo "For more help, see STRIPE_SETUP.md"
echo ""
