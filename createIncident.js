const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const { createHash, randomBytes } = require("crypto");
const { broadcastIncident } = require("./websocket/broadcast");

const client = new DynamoDBClient({});
const INCIDENT_TABLE = process.env.INCIDENT_TABLE;

// Generador simple de incidentId (no depende de libs externas)
function generateIncidentId() {
  const raw = `${Date.now()}:${Math.random()}:${randomBytes(8).toString("hex")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  return `INC-${hash.substring(0, 16)}`;
}

// Normalizar y validar campos básicos
const allowedCategories = ["IT", "Cleaner", "Infrastructure", "Security", "Emergency"];
const allowedUrgency = ["low", "medium", "high"];

const { json } = require("./http");

exports.handler = async (event) => {
  try {
    if (!INCIDENT_TABLE) {
      console.error("ENV ERROR: INCIDENT_TABLE is not configured");
      return json(500, { message: "Server misconfiguration, ENV ERROR: INCIDENT_TABLE is not configured" }, event);
    }

    // Obtener user desde authorizer (authorizer.js pone payload en context)
    const auth = (event.requestContext && event.requestContext.authorizer) || {};
    const createdBy = auth.userId || auth.principalId;
    if (!createdBy) {
      return json(401, { message: "Unauthorized: missing user context" }, event);
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { category, place, description, urgency } = body;

    // Validaciones
    if (!category || typeof category !== "string" || !allowedCategories.includes(category)) {
      return json(400, { message: `category must be one of: ${allowedCategories.join(", ")}` }, event);
    }
    if (!place || typeof place !== "string" || !place.trim()) {
      return json(400, { message: "place is required and must be a non-empty string" }, event);
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      return json(400, { message: "description is required and must be a non-empty string" }, event);
    }

    // Urgency: por defecto 'low' si no se provee. Si se provee, validar que sea permitido.
    let finalUrgency = "low";
    if (urgency !== undefined && urgency !== null && urgency !== "") {
      if (typeof urgency !== "string" || !allowedUrgency.includes(urgency)) {
        return json(400, { message: `urgency must be one of: ${allowedUrgency.join(", ")}` }, event);
      }
      finalUrgency = urgency;
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
      urgency: { S: finalUrgency },
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
      urgency: finalUrgency,
      place: place.trim(),
      description: description.trim(),
    };

    await broadcastIncident({
      event: "incidentCreated",
      ...incidentResponse
    });

    return json(201, { message: "Incident created", incident: incidentResponse }, event);

  } catch (err) {
    console.error("CREATE INCIDENT ERROR:", err);
    // Si falla ConditionExpression por colisión (extremadamente raro), retornar 409
    if (err.name === "ConditionalCheckFailedException") {
      return json(409, { message: "Incident already exists" }, event);
    }
    return json(500, { message: "Server error", error: err.message }, event);
  }
};
