import { createHmac } from "crypto";

// Convertir Base64URL a Buffer
function fromBase64url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad) str += "=".repeat(4 - pad);
  return Buffer.from(str, "base64").toString();
}

export const handler = async (event) => {
  try {
    const token = event.authorizationToken;

    // Validar que el token existe
    if (!token) {
      console.error("AUTHORIZER ERROR: No token provided");
      throw new Error("Unauthorized");
    }

    // Verificar que JWT_SECRET está configurado
    if (!process.env.JWT_SECRET) {
      console.error("AUTHORIZER ERROR: JWT_SECRET not configured");
      throw new Error("Unauthorized");
    }

    // Extraer el token (remover "Bearer " si existe)
    const raw = token.replace(/^Bearer\s+/i, "").trim();

    if (!raw || raw.length === 0) {
      console.error("AUTHORIZER ERROR: Empty token after processing");
      throw new Error("Unauthorized");
    }

    // Validar formato del token (debe tener 3 partes separadas por puntos)
    const parts = raw.split(".");
    if (parts.length !== 3) {
      console.error("AUTHORIZER ERROR: Invalid token format");
      throw new Error("Unauthorized");
    }

    const [headerEnc, payloadEnc, signature] = parts;

    // Verificar que las partes no estén vacías
    if (!headerEnc || !payloadEnc || !signature) {
      console.error("AUTHORIZER ERROR: Token parts are empty");
      throw new Error("Unauthorized");
    }

    // Verificar firma del token
    const data = `${headerEnc}.${payloadEnc}`;

    const expectedSig = createHmac("sha256", process.env.JWT_SECRET)
      .update(data)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    if (signature !== expectedSig) {
      console.error("AUTHORIZER ERROR: Invalid signature");
      throw new Error("Unauthorized");
    }

    // Decodificar payload
    let payload;
    try {
      payload = JSON.parse(fromBase64url(payloadEnc));
    } catch (parseError) {
      console.error("AUTHORIZER ERROR: Failed to parse payload", parseError);
      throw new Error("Unauthorized");
    }

    // Validar campos requeridos en el payload
    if (!payload.userId || !payload.role || !payload.email) {
      console.error("AUTHORIZER ERROR: Missing required fields in payload");
      throw new Error("Unauthorized");
    }

    // Verificar expiración del token
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.error("AUTHORIZER ERROR: Token expired");
      throw new Error("Unauthorized");
    }

    // Retornar política IAM con contexto
    return {
      principalId: payload.userId,
      policyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Action: "execute-api:Invoke",
            Effect: "Allow",
            Resource: event.methodArn,
          },
        ],
      },
      context: payload,
    };

  } catch (err) {
    console.error("AUTHORIZER ERROR:", err);
    throw new Error("Unauthorized");
  }
};
