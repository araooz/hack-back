import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { createHash, createHmac } from "crypto";

const client = new DynamoDBClient({});
const USERS_TABLE = "UserTable";

// Verificar contraseña
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const newHash = createHash("sha256").update(salt + password).digest("hex");
  return newHash === hash;
}

// Helper Base64URL
function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

// Generador de JWT nativo
function signJWT(payload, secret, expiresInSec = 3600) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const current = Math.floor(Date.now() / 1000);
  payload.exp = current + expiresInSec;

  const headerEnc = base64url(JSON.stringify(header));
  const payloadEnc = base64url(JSON.stringify(payload));

  const data = `${headerEnc}.${payloadEnc}`;

  const signature = createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${data}.${signature}`;
}

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { email, password } = body;

    // Validar campos requeridos
    if (!email || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing fields: email and password are required" }),
      };
    }

    // Normalizar email para comparacion
    const normalizedEmail = email.toLowerCase().trim();

    // Buscar usuario por email o username
    const res = await client.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: "email = :e OR username = :e",
        ExpressionAttributeValues: {
          ":e": { S: normalizedEmail },
        },
      })
    );

    if (!res.Items || res.Items.length === 0) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Invalid credentials" }),
      };
    }

    const user = res.Items[0];

    // Verificar contraseña
    if (!user.password || !user.password.S) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Invalid credentials" }),
      };
    }

    const valid = verifyPassword(password, user.password.S);
    if (!valid) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: "Invalid credentials" }),
      };
    }

    // Generar JWT
    const payload = {
      userId: user.userId.S,
      role: user.role.S,
      email: user.email.S,
    };

    // Agregar component al payload si existe
    if (user.component && user.component.S) {
      payload.component = user.component.S;
    }

    const token = signJWT(payload, process.env.JWT_SECRET);

    return {
      statusCode: 200,
      body: JSON.stringify({ token }),
    };

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Server error", error: err.message }),
    };
  }
};
