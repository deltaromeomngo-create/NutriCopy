// lib/entitlement.server.cjs
// Server-only helpers for session + subscription entitlement
// CommonJS (Vercel-compatible)

const { kv } = require("@vercel/kv");
const crypto = require("crypto");

const SID_COOKIE = "nc_sid";

/* -----------------------------
   Session cookie helpers
------------------------------ */

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, decodeURIComponent(v.join("="))];
    })
  );
}

function serializeCookie(name, value, options = {}) {
  let str = `${name}=${encodeURIComponent(value)}`;
  if (options.httpOnly) str += "; HttpOnly";
  if (options.sameSite) str += `; SameSite=${options.sameSite}`;
  if (options.path) str += `; Path=${options.path}`;
  if (options.secure) str += "; Secure";
  return str;
}

function getOrCreateSessionId(req, res) {
  const cookies = parseCookies(req);
  let sid = cookies[SID_COOKIE];

  if (!sid) {
    sid = crypto.randomUUID();

    const cookie = serializeCookie(SID_COOKIE, sid, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });

    res.setHeader("Set-Cookie", cookie);
  }

  return sid;
}

/* -----------------------------
   KV helpers
------------------------------ */

// Maps: nc:sid:{sid} -> stripeCustomerId
async function getCustomerIdForSid(sid) {
  return kv.get(`nc:sid:${sid}`);
}

async function setCustomerIdForSid(sid, customerId) {
  return kv.set(`nc:sid:${sid}`, customerId);
}

// Maps: nc:customer:{customerId} -> subscription state
async function getCustomerEntitlement(customerId) {
  if (!customerId) return null;
  return kv.get(`nc:customer:${customerId}`);
}

async function setCustomerEntitlement(customerId, data) {
  return kv.set(`nc:customer:${customerId}`, data);
}

/* -----------------------------
   High-level check
------------------------------ */


async function isSubscribedForRequest(req, res) {
  const sid = getOrCreateSessionId(req, res);
  console.log("[entitlement] SID:", sid);

  const customerId = await getCustomerIdForSid(sid);
  console.log("[entitlement] customerId:", customerId);

  if (!customerId) return false;

  const entitlement = await getCustomerEntitlement(customerId);
  console.log("[entitlement] entitlement:", entitlement);

  if (!entitlement) return false;

  return entitlement.subscribed === true;
}


module.exports = {
  getOrCreateSessionId,
  getCustomerIdForSid,
  setCustomerIdForSid,
  getCustomerEntitlement,
  setCustomerEntitlement,
  isSubscribedForRequest,
};


