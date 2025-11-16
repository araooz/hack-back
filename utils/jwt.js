const { createHmac } = require("crypto");

function fromBase64url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad) str += "=".repeat(4 - pad);
  return Buffer.from(str, "base64").toString();
}

exports.decodeAndVerifyJWT = (token) => {
  if (!token) throw new Error("Missing token");

  if (!process.env.JWT_SECRET) {
    console.error("JWT ERROR: JWT_SECRET not configured");
    throw new Error("Unauthorized");
  }

  // Remove "Bearer "
  const raw = token.replace(/^Bearer\s+/i, "").trim();
  const parts = raw.split(".");
  if (parts.length !== 3) {
    console.error("JWT ERROR: invalid format");
    throw new Error("Unauthorized");
  }

  const [headerEnc, payloadEnc, signature] = parts;

  // Validate non-empty
  if (!headerEnc || !payloadEnc || !signature) {
    console.error("JWT ERROR: token missing parts");
    throw new Error("Unauthorized");
  }

  // Validate signature
  const data = `${headerEnc}.${payloadEnc}`;

  const expectedSig = createHmac("sha256", process.env.JWT_SECRET)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (signature !== expectedSig) {
    console.error("JWT ERROR: signature mismatch");
    throw new Error("Unauthorized");
  }

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(fromBase64url(payloadEnc));
  } catch (e) {
    console.error("JWT ERROR: payload decode failed", e);
    throw new Error("Unauthorized");
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    console.error("JWT ERROR: expired token");
    throw new Error("Unauthorized");
  }

  return payload; // userId, role, email, department (if worker)
};
