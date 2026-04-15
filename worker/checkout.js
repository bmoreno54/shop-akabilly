/**
 * checkout.js — Cloudflare Worker for shop.akabilly.com
 * 
 * Genre: Commerce / Transaction Pipeline
 * Water Cycle: This is the precipitation engine — the moment where
 *   browsing becomes buying, where art exits the digital catalog
 *   and enters someone's physical world.
 * 
 * Flow: Square tokenized payment → validate → charge → Prodigi order → confirm
 * 
 * Env vars required:
 *   SQUARE_ACCESS_TOKEN   — Square API access token
 *   SQUARE_LOCATION_ID    — Square location ID
 *   PRODIGI_API_KEY        — Prodigi API key
 *   PRODIGI_ENV            — 'sandbox' or 'live'
 *   PRINT_IMAGE_URL        — Public URL to the print-ready image
 * 
 * Future Directions:
 *   - Webhook for Prodigi shipping notifications
 *   - Order status page
 *   - Email confirmation via Resend or SES
 *   - Inventory tracking in catalog JSON
 */

// -- Product/variant → Prodigi SKU mapping --
const VARIANT_MAP = {
  'lode-12x12': { sku: 'GLOBAL-FAP-12x12', price: 2500 },
  'lode-16x16': { sku: 'GLOBAL-FAP-16x16', price: 4000 },
  'lode-20x20': { sku: 'GLOBAL-FAP-20x20', price: 6500 },
};
export default {
  async fetch(request, env) {
    // CORS headers for the static site
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/checkout' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { sourceId, variantId, amount, currency, shipping } = body;

        // Validate variant and price
        const variant = VARIANT_MAP[variantId];
        if (!variant || variant.price !== amount) {
          return jsonResponse({ error: 'Invalid variant or price mismatch' }, 400, corsHeaders);
        }

        // Step 1: Charge via Square Payments API
        const squarePayment = await chargeSquare(env, sourceId, amount, currency);
        if (!squarePayment.ok) {
          const err = await squarePayment.json();
          return jsonResponse({ error: 'Payment failed', details: err }, 402, corsHeaders);
        }
        const paymentData = await squarePayment.json();
        const paymentId = paymentData.payment?.id;

        // Step 2: Create Prodigi print order
        const prodigiOrder = await createProdigiOrder(env, variant.sku, shipping);
        const orderData = await prodigiOrder.json();

        return jsonResponse({
          success: true,
          paymentId,
          orderId: orderData.order?.id || 'pending',
          message: 'Payment processed, print order created'
        }, 200, corsHeaders);

      } catch (err) {
        return jsonResponse({ error: err.message }, 500, corsHeaders);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  }
};
// -- Square Payments API --
async function chargeSquare(env, sourceId, amount, currency) {
  const idempotencyKey = crypto.randomUUID();
  const squareBase = env.SQUARE_ENV === 'live'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
  return fetch(`${squareBase}/v2/payments`, {
    method: 'POST',
    headers: {
      'Square-Version': '2024-01-18',
      'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      amount_money: {
        amount,       // in cents
        currency,     // 'USD'
      },
      location_id: env.SQUARE_LOCATION_ID,
      note: 'akabilly art print order',
    }),
  });
}
// -- Prodigi Print API --
async function createProdigiOrder(env, sku, shipping) {
  const prodigiBase = env.PRODIGI_ENV === 'live'
    ? 'https://api.prodigi.com'
    : 'https://api.sandbox.prodigi.com';

  return fetch(`${prodigiBase}/v4.0/Orders`, {
    method: 'POST',
    headers: {
      'X-API-Key': env.PRODIGI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      shippingMethod: 'Standard',
      recipient: {
        name: shipping.name,
        email: shipping.email,
        address: {
          line1: shipping.line1,
          line2: shipping.line2 || '',
          postalOrZipCode: shipping.postalCode,
          townOrCity: shipping.city,
          stateOrCounty: shipping.state,
          countryCode: shipping.country,
        },
      },
      items: [{
        sku,
        copies: 1,
        sizing: 'fillPrintArea',
        assets: [{
          printArea: 'default',
          url: env.PRINT_IMAGE_URL,
        }],
      }],
    }),
  });
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}