const { createHash, randomBytes } = require("crypto");
const { DynamoDBClient, PutItemCommand, QueryCommand } = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({});
const USERS_TABLE = process.env.USER_TABLE;

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
  const validRoles = ["Worker", "User", "Admin"];
  return validRoles.includes(role);
}

// Validar department
function isValidDepartment(department) {
  const validDepartments = ["IT", "Cleaner", "Infrastructure", "Security", "Emergency", "None"];
  if (!department || department === null || department === undefined || department === "") {
    return true; // Se convertirá a "None"
  }
  return validDepartments.includes(department);
}

const { json } = require("./http");

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const { email, username, password, role, department } = body;

    if (!email || !username || !password || !role) {
      return json(400, { message: "Missing fields" }, event);
    }

    // Validar formato de email
    if (!isValidEmail(email)) {
      return json(400, { message: "Invalid email format" }, event);
    }

    // Validar fortaleza de contraseña
    const passwordValidation = isStrongPassword(password);
    if (!passwordValidation.valid) {
      return json(400, { message: passwordValidation.message }, event);
    }

    // Validar role
    if (!isValidRole(role)) {
      return json(400, { message: "Invalid role. Must be one of: Worker, User, Admin" }, event);
    }

    // Validar department
    if (!isValidDepartment(department)) {
      return json(400, { message: "Invalid department. Must be one of: IT, Cleaner, Infrastructure, Security, Emergency, or None" }, event);
    }

    // Normalizar email y username para comparacion
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();
    const normalizedRole = role.toLowerCase();

    // Verificar si el email ya existe
    const emailCheck = await client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: "EmailIndex",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": { S: normalizedEmail },
        },
      })
    );

    if (emailCheck.Items && emailCheck.Items.length > 0) {
      return json(409, { message: "Email already registered" }, event);
    }

    // Verificar si el username ya existe
    const usernameCheck = await client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: "UsernameIndex",
        KeyConditionExpression: "username = :username",
        ExpressionAttributeValues: {
          ":username": { S: normalizedUsername },
        },
      })
    );

    if (usernameCheck.Items && usernameCheck.Items.length > 0) {
      return json(409, { message: "Username already taken" }, event);
    }

    const hashedPassword = hashPassword(password);
    const userId = generateUserId(normalizedEmail, normalizedUsername);

    // Insertar con ConditionExpression para evitar duplicados por userId
    try {
      // Normalizar department: si es null/undefined/vacío, usar "None"
      const normalizedDepartment = 
        (department && department !== null && department !== undefined && department !== "") 
          ? department 
          : "None";

      const item = {
        userId: { S: userId },
        email: { S: normalizedEmail },
        username: { S: normalizedUsername },
        password: { S: hashedPassword },
        role: { S: normalizedRole },
        department: { S: normalizedDepartment },
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
        return json(409, { message: "User already exists" }, event);
      }
      throw putError;
    }

    return json(201, { message: "User created", userId }, event);

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    
    return json(500, { message: "Server error", error: err.message }, event);
  }
};
