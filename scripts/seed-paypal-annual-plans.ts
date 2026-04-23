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

  // Lump sum: billed once per year
  const plans = [
    { key: 'essentials', label: 'Essentials', amount: '180.00' }, // $15 x 12
    { key: 'portal',     label: 'Portal',     amount: '348.00' }, // $29 x 12
    { key: 'depth',      label: 'Depth',      amount: '708.00' }, // $59 x 12
  ];

  const results: Record<string, string> = {};

  for (const plan of plans) {
    console.log(`\n--- Creating ${plan.label} annual plan ---`);

    // Step 2: Create product
    const product = await paypalPost('/v1/catalogs/products', {
      name: `Astar ${plan.label}`,
      description: `Astar ${plan.label} subscription`,
      type: 'SERVICE',
      category: 'SOFTWARE',
    });
    console.log(`  Product ID: ${product.id}`);

    // Step 3: Create plan — 1 charge per year, infinite renewals
    const created = await paypalPost('/v1/billing/plans', {
      product_id: product.id,
      name: `Astar ${plan.label} Annual`,
      description: `Annual subscription billed as a lump sum of $${plan.amount} USD per year`,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: 'YEAR', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0, // 0 = renews indefinitely
          pricing_scheme: {
            fixed_price: { value: plan.amount, currency_code: 'USD' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    });

    console.log(`  Plan ID: ${created.id}`);
    results[`PAYPAL_PLAN_ID_${plan.key.toUpperCase()}_ANNUAL`] = created.id;
  }

  // Print ready-to-paste .env lines
  console.log('\n\n✅ Add these to your .env:\n');
  for (const [key, value] of Object.entries(results)) {
    console.log(`${key}=${value}`);
  }
}

main().catch(console.error);