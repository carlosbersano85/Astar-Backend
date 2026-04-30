// scripts/seed-paypal-annual-plans.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadEnvFromProjectRoot() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvFromProjectRoot();

  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const isLive = process.env.PAYPAL_ENV?.trim().toLowerCase() === 'live';
  const baseUrl = isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

  if (!clientId || !clientSecret) {
    throw new Error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env.');
  }

  console.log('PayPal env:', isLive ? 'live' : 'sandbox');

  // Step 1: Get access token
  const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const tokenData = await tokenRes.json();
  console.log('Token response status:', tokenRes.status);

  if (!tokenRes.ok) {
    console.log('Token error:', JSON.stringify(tokenData, null, 2));
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }

  const access_token = tokenData.access_token as string;

  async function paypalPost(path: string, body: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`PayPal error on ${path}: ${JSON.stringify(data, null, 2)}`);
    return data;
  }

  // Prices must match PaymentsService.getPlanAmount()
const plans = [
  {
    key: 'luminary',
    label: 'Luminary',
    prices: { monthly: '29.00' },
  },
];

  const results: Record<string, string> = {};

  for (const plan of plans) {
    console.log(`\n--- Creating ${plan.label} product and plans ---`);

    // Step 2: Create product
    const product = await paypalPost('/v1/catalogs/products', {
      name: `Astar ${plan.label}`,
      description: `Astar ${plan.label} subscription`,
      type: 'SERVICE',
      category: 'SOFTWARE',
    });
    console.log(`  Product ID: ${product.id}`);

    const cycles = [
      {
        key: 'monthly',
        label: 'Monthly',
        amount: plan.prices.monthly,
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        description: `Monthly subscription billed at $${plan.prices.monthly} USD per month`,
      },
    ] as const;

    // Step 3: Create monthly + annual plans with infinite renewals
    for (const cycle of cycles) {
      const created = await paypalPost('/v1/billing/plans', {
        product_id: product.id,
        name: `Astar ${plan.label} ${cycle.label}`,
        description: cycle.description,
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: cycle.frequency,
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0, // 0 = renews indefinitely
            pricing_scheme: {
              fixed_price: { value: cycle.amount, currency_code: 'USD' },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          payment_failure_threshold: 3,
        },
      });

      const envKey = `PAYPAL_PLAN_ID_${plan.key.toUpperCase()}_${cycle.key.toUpperCase()}`;
      console.log(`  ${cycle.label} Plan ID: ${created.id}`);
      results[envKey] = created.id;
    }
  }

  // Print ready-to-paste .env lines
  console.log('\n\n✅ Add these to your .env:\n');
  for (const [key, value] of Object.entries(results)) {
    console.log(`${key}=${value}`);
  }
}

main().catch(console.error);