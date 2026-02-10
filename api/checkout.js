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
    const corsOrigin = req.headers.origin;

    if (corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      res.setHeader("Vary", "Origin");
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }


    // Ensure session cookie exists
    const sid = getOrCreateSessionId(req, res);

    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
      return res.status(500).json({
        error: "Stripe not configured",
      });
    }

    

    // Derive origin for success/cancel URLs (works on Vercel + local)
    const redirectOrigin =
      process.env.VERCEL_ENV === "production"
        ? "https://nutri-copy-22vy.vercel.app"
        : req.headers.origin || `https://${req.headers.host}`;


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

      success_url: `${redirectOrigin}/?checkout=success`,
      cancel_url: `${redirectOrigin}/?checkout=cancel`,


      allow_promotion_codes: true,
    });

    return res.status(200).json({
      checkoutUrl: session.url,
    });
  } catch (err) {
    console.error("[checkout] error:", err);
    return res.status(500).json({
      error: "Checkout failed",
      message: String(err?.message || err),
    });
  }
};
