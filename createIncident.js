const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const { createHash, randomBytes } = require("crypto");

const client = new DynamoDBClient({});
const INCIDENT_TABLE = process.env.INCIDENT_TABLE;

// Generador simple de incidentId (no depende de libs externas)
function generateIncidentId() {
  const raw = `${Date.now()}:${Math.random()}:${randomBytes(8).toString("hex")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return `INC-${hash.substring(0, 16)}`;
}

// Normalizar y validar campos básicos
const allowedCategories = ["Limpieza", "infraestructura", "TI", "Seguridad", "Emergencia"];
const allowedUrgency = ["low", "medium", "high"];

exports.handler = async (event) => {
  try {
    if (!INCIDENT_TABLE) {
      console.error("ENV ERROR: INCIDENT_TABLE is not configured");
      return { statusCode: 500, body: JSON.stringify({ message: "Server misconfiguration" }) };
    }

    // Obtener user desde authorizer (authorizer.js pone payload en context)
    const auth = (event.requestContext && event.requestContext.authorizer) || {};
    const createdBy = auth.userId || auth.principalId;
    if (!createdBy) {
      return { statusCode: 401, body: JSON.stringify({ message: "Unauthorized: missing user context" }) };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { category, place, description, urgency } = body;

    // Validaciones
    if (!category || typeof category !== "string" || !allowedCategories.includes(category)) {
      return { statusCode: 400, body: JSON.stringify({ message: `category must be one of: ${allowedCategories.join(", ")}` }) };
    }
    if (!place || typeof place !== "string" || !place.trim()) {
      return { statusCode: 400, body: JSON.stringify({ message: "place is required and must be a non-empty string" }) };
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      return { statusCode: 400, body: JSON.stringify({ message: "description is required and must be a non-empty string" }) };
    }
    if (urgency && !allowedUrgency.includes(urgency)) {
      return { statusCode: 400, body: JSON.stringify({ message: `urgency must be one of: ${allowedUrgency.join(", ")}` }) };
    }

    // Datos del incidente
    const incidentId = generateIncidentId();
    const createdAt = new Date().toISOString();
    const item = {
      incidentId: { S: incidentId },
      createdAt: { S: createdAt },
      createdBy: { S: createdBy },
      solvedBy: { NULL: true },
      solvedAt: { NULL: true },
      category: { S: category },
      status: { S: "reported" }, 
      urgency: urgency ? { S: urgency } : { NULL: true },
      place: { S: place.trim() },
      description: { S: description.trim() },
    };

    // Guardar en DynamoDB
    await client.send(
      new PutItemCommand({
        TableName: INCIDENT_TABLE,
        Item: item,
        // Evitar sobreescritura (en caso de colisión improbable)
        ConditionExpression: "attribute_not_exists(incidentId)",
      })
    );

    const incidentResponse = {
      incidentId,
      createdAt,
      createdBy,
      solvedBy: null,
      solvedAt: null,
      category,
      status: "reported",
      urgency: urgency || null,
      place: place.trim(),
      description: description.trim(),
    };

    return {
      statusCode: 201,
      body: JSON.stringify({ message: "Incident created", incident: incidentResponse }),
    };

  } catch (err) {
    console.error("CREATE INCIDENT ERROR:", err);
    // Si falla ConditionExpression por colisión (extremadamente raro), retornar 409
    if (err.name === "ConditionalCheckFailedException") {
      return { statusCode: 409, body: JSON.stringify({ message: "Incident already exists" }) };
    }
    return { statusCode: 500, body: JSON.stringify({ message: "Server error", error: err.message }) };
  }
};
