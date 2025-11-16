import { createHash, randomBytes } from "crypto";
import { DynamoDBClient, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({});
const USERS_TABLE = "UserTable";

// Hash seguro nativo (SHA256 + salt)
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

// Validar fortaleza de contraseña
function isStrongPassword(password) {
  // Mínimo 8 caracteres
  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters long" };
  }
  
  // Al menos una minúscula
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter" };
  }
  
  // Al menos un número
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one number" };
  }
  
  return { valid: true };
}

// Generador de userId único
function generateUserId(email, username) {
  const raw = `${email}:${username}:${Date.now()}:${Math.random()}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return `USR-${hash.substring(0, 16)}`;
}

// Validar formato de email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Validar role
function isValidRole(role) {
  const validRoles = ["worker", "user", "admin"];
  return validRoles.includes(role.toLowerCase());
}

// Validar component
function isValidComponent(component) {
  const validComponents = ["IT", "Cleaner", "Infrastructure", "Security", "Emergency", "noBlank"];
  if (!component || component === null || component === undefined || component === "") {
    return true; // Se convertirá a "noBlank"
  }
  return validComponents.includes(component);
}

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { email, username, password, role, component } = body;

    if (!email || !username || !password || !role) {
      return { statusCode: 400, body: JSON.stringify({ message: "Missing fields" }) };
    }

    // Validar formato de email
    if (!isValidEmail(email)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Invalid email format" }),
      };
    }

    // Validar fortaleza de contraseña
    const passwordValidation = isStrongPassword(password);
    if (!passwordValidation.valid) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: passwordValidation.message }),
      };
    }

    // Validar role
    if (!isValidRole(role)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          message: "Invalid role. Must be one of: worker, user, admin" 
        }),
      };
    }

    // Validar component
    if (!isValidComponent(component)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          message: "Invalid component. Must be one of: IT, Cleaner, Infrastructure, Security, Emergency, or noBlank" 
        }),
      };
    }

    // Normalizar email y username para comparacion
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();
    const normalizedRole = role.toLowerCase();

    // Verificar si el email ya existe
    const emailCheck = await client.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": { S: normalizedEmail },
        },
      })
    );

    if (emailCheck.Items && emailCheck.Items.length > 0) {
      return {
        statusCode: 409,
        body: JSON.stringify({ message: "Email already registered" }),
      };
    }

    // Verificar si el username ya existe
    const usernameCheck = await client.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: "username = :username",
        ExpressionAttributeValues: {
          ":username": { S: normalizedUsername },
        },
      })
    );

    if (usernameCheck.Items && usernameCheck.Items.length > 0) {
      return {
        statusCode: 409,
        body: JSON.stringify({ message: "Username already taken" }),
      };
    }

    const hashedPassword = hashPassword(password);
    const userId = generateUserId(normalizedEmail, normalizedUsername);

    // Insertar con ConditionExpression para evitar duplicados por userId
    try {
      // Normalizar component: si es null/undefined/vacío, usar "noBlank"
      const normalizedComponent = 
        (component && component !== null && component !== undefined && component !== "") 
          ? component 
          : "noBlank";

      const item = {
        userId: { S: userId },
        email: { S: normalizedEmail },
        username: { S: normalizedUsername },
        password: { S: hashedPassword },
        role: { S: normalizedRole },
        component: { S: normalizedComponent },
      };

      await client.send(
        new PutItemCommand({
          TableName: USERS_TABLE,
          Item: item,
          ConditionExpression: "attribute_not_exists(userId)",
        })
      );
    } catch (putError) {
      if (putError.name === "ConditionalCheckFailedException") {
        return {
          statusCode: 409,
          body: JSON.stringify({ message: "User already exists" }),
        };
      }
      throw putError;
    }

    return {
      statusCode: 201,
      body: JSON.stringify({ message: "User created", userId }),
    };

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Server error", error: err.message }),
    };
  }
};