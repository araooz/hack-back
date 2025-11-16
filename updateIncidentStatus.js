const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { broadcastIncident } = require("./websocket/broadcast");

const client = new DynamoDBClient({});
const INCIDENT_TABLE = process.env.INCIDENT_TABLE;

// Estados válidos para cambio (reported es el estado inicial y no se puede cambiar a él)
const VALID_STATUSES = ["assigned", "working", "solved", "cancelled"];

// Validar estado
function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

// Verificar permisos según el rol
function canChangeStatus(role, newStatus) {
  const normalizedRole = role ? role.toLowerCase() : "";
  
  // Los usuarios solo pueden cambiar a "cancelled"
  if (normalizedRole === "user") {
    return newStatus === "cancelled";
  }
  
  // Los workers pueden cambiar a assigned, working, solved
  if (normalizedRole === "worker") {
    return ["assigned", "working", "solved"].includes(newStatus);
  }
  
  // Los admins pueden cambiar a cualquier estado válido
  if (normalizedRole === "admin") {
    return true;
  }
  
  return false;
}

// Validar transición de estado (solo se puede avanzar, no retroceder)
function isValidTransition(currentStatus, newStatus) {
  const current = currentStatus ? currentStatus.toLowerCase() : "";
  const next = newStatus ? newStatus.toLowerCase() : "";
  
  // Si el estado actual es solved o cancelled, no se puede cambiar
  if (current === "solved" || current === "cancelled") {
    return false;
  }
  
  // Transiciones válidas:
  // reported -> assigned, cancelled
  // assigned -> working, cancelled
  // working -> solved, cancelled
  
  if (current === "reported") {
    return next === "assigned" || next === "cancelled";
  }
  
  if (current === "assigned") {
    return next === "working" || next === "cancelled";
  }
  
  if (current === "working") {
    return next === "solved" || next === "cancelled";
  }
  
  return false;
}

const { json } = require("./http");

exports.handler = async (event) => {
  try {
    // Obtener user desde authorizer (authorizer.js pone payload en context)
    const auth = (event.requestContext && event.requestContext.authorizer) || {};
    const userId = auth.userId || auth.principalId;
    const userRole = auth.role;
    
    if (!userId || !userRole) {
      return json(401, { message: "Unauthorized: missing user context" }, event);
    }

    // Validar que la tabla está configurada
    if (!INCIDENT_TABLE) {
      console.error("ENV ERROR: INCIDENT_TABLE is not configured");
      return json(500, { message: "Server misconfiguration, ENV ERROR: INCIDENT_TABLE is not configured" }, event);
    }

    // Parsear el body
    const body = event.body ? JSON.parse(event.body) : {};
    const { incidentId, status } = body;

    // Validar campos requeridos
    if (!incidentId || !status) {
      return json(400, { message: "Missing required fields: incidentId and status" }, event);
    }

    // Validar que el estado es válido
    if (!isValidStatus(status)) {
      return json(400, { message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` }, event);
    }

    // Verificar permisos
    if (!canChangeStatus(userRole, status)) {
      return json(403, { message: `Forbidden: Your role (${userRole}) does not have permission to change status to ${status}` }, event);
    }

    // Verificar que el incidente existe
    const getIncident = await client.send(
      new GetItemCommand({
        TableName: INCIDENT_TABLE,
        Key: {
          incidentId: { S: incidentId },
        },
      })
    );

    if (!getIncident.Item) {
      return json(404, { message: "Incident not found" }, event);
    }

    const incident = getIncident.Item;
    const currentStatus = incident.status?.S || "";

    if (status && status.toLowerCase() === "reported") {
      return json(400, { message: "Cannot change status to 'reported'. This is the initial state and cannot be set manually." }, event);
    }

    // Validar transición de estado (solo se puede avanzar, no retroceder)
    if (!isValidTransition(currentStatus, status)) {
      return json(400, { message: `Invalid status transition. Cannot change from '${currentStatus}' to '${status}'. Status can only advance forward.` }, event);
    }

    // Verificar que el usuario es el creador del incidente (para usuarios que quieren cancelar)
    if (userRole.toLowerCase() === "user") {
      const createdBy = incident.createdBy?.S;
      if (createdBy !== userId) {
        return json(403, { message: "Forbidden: You can only cancel incidents that you created" }, event);
      }
    }

    // Preparar la actualización
    const updateExpression = ["SET #status = :status"];
    const expressionAttributeNames = { "#status": "status" };
    const expressionAttributeValues = { ":status": { S: status } };

    // Si el estado cambia a "solved", actualizar solvedBy y solvedAt
    if (status === "solved") {
      updateExpression.push("solvedBy = :solvedBy", "solvedAt = :solvedAt");
      expressionAttributeValues[":solvedBy"] = { S: userId };
      expressionAttributeValues[":solvedAt"] = { S: new Date().toISOString() };
    }

    // Actualizar el incidente
    await client.send(
      new UpdateItemCommand({
        TableName: INCIDENT_TABLE,
        Key: {
          incidentId: { S: incidentId },
        },
        UpdateExpression: updateExpression.join(", "),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    await broadcastIncident({
      event: "incidentUpdated",
      incidentId,
      previousStatus: currentStatus,
      newStatus: status,
      updatedBy: userId,
      category: incident.category.S
    })

    return json(200, { message: "Incident status updated successfully", incidentId, previousStatus: currentStatus, newStatus: status }, event);

  } catch (err) {
    console.error("UPDATE INCIDENT STATUS ERROR:", err);
    return json(500, { message: "Server error", error: err.message }, event);
  }
};

