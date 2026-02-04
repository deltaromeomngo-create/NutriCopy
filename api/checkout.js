// api/checkout.js
// Create Stripe Checkout Session for NutriCopy subscription
// CommonJS ONLY

const Stripe = require("stripe");
const {
  getOrCreateSessionId,
} = require("../lib/entitlement.server.cjs");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

module.exports = async function handler(req, res) {
  try {
    // --- CORS (preflight-safe) ---
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    // Ensure session cookie exists
    const sid = getOrCreateSessionId(req, res);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],

      // Link Stripe session back to our anonymous session
      client_reference_id: sid,

      // These can be updated later; placeholders are fine for now
      success_url: "http://localhost:3000/?checkout=success",
      cancel_url: "http://localhost:3000/?checkout=cancel",

      allow_promotion_codes: true,
    });

    return res.status(200).json({
      checkoutUrl: session.url,
    });
  } catch (err) {
    console.error("[checkout] error:", err);
    return res.status(500).json({
      error: "Checkout failed",
    });
  }
};
