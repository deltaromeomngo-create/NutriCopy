// api/stripe/webhook.js
// Stripe webhook handler for NutriCopy subscriptions
// CommonJS ONLY

const Stripe = require("stripe");
const {
  setCustomerEntitlement,
  setCustomerIdForSid,
} = require("../../lib/entitlement.server.cjs");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let event;

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err.message);
    return res.status(400).send("Invalid signature");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        const customerId = session.customer;
        const sid = session.client_reference_id;

        if (customerId && sid) {
          await setCustomerIdForSid(sid, customerId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;

        const customerId = sub.customer;
        const status = sub.status;

        const subscribed = status === "active" || status === "trialing";

        await setCustomerEntitlement(customerId, {
          subscribed,
          subscriptionId: sub.id,
          priceId: sub.items?.data?.[0]?.price?.id,
          status,
        });
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        if (customerId) {
          await setCustomerEntitlement(customerId, {
            subscribed: true,
            status: "active",
          });
        }
        break;
      }


      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;

        await setCustomerEntitlement(customerId, {
          subscribed: false,
          subscriptionId: sub.id,
          status: "deleted",
        });
        break;
      }

      default:
        // Ignore all other events
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    res.status(500).json({ error: "Webhook handler failed" });
  }
};
