const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({});
const INCIDENT_TABLE = process.env.INCIDENT_TABLE;

// Función auxiliar para convertir items de DynamoDB a objetos JavaScript
function unmarshallItem(item) {
  const result = {};
  for (const [key, value] of Object.entries(item)) {
    if (value.S) {
      result[key] = value.S;
    } else if (value.N) {
      result[key] = Number(value.N);
    } else if (value.BOOL !== undefined) {
      result[key] = value.BOOL;
    } else if (value.NULL) {
      result[key] = null;
    } else if (value.L) {
      result[key] = value.L.map((v) => unmarshallItem({ temp: v }).temp);
    } else if (value.M) {
      result[key] = unmarshallItem(value.M);
    }
  }
  return result;
}

const { json } = require("./http");

exports.handler = async (event) => {
  try {
    // Validar que la tabla está configurada
    if (!INCIDENT_TABLE) {
      console.error("ENV ERROR: INCIDENT_TABLE is not configured");
      return json(500, { message: "Server misconfiguration, ENV ERROR: INCIDENT_TABLE is not configured" }, event);
    }

    // Obtener user desde authorizer (authorizer.js pone payload en context)
    const auth = (event.requestContext && event.requestContext.authorizer) || {};
    const userId = auth.userId || auth.principalId;
    
    if (!userId) {
      return json(401, { message: "Unauthorized: missing user context" }, event);
    }

    // Escanear todos los incidentes de la tabla
    const scanResult = await client.send(
      new ScanCommand({
        TableName: INCIDENT_TABLE,
      })
    );

    // Convertir los items de DynamoDB a objetos JavaScript normales
    const incidents = (scanResult.Items || []).map((item) => unmarshallItem(item));

    return json(200, { message: "Incidents retrieved successfully", incidents, count: incidents.length }, event);

  } catch (err) {
    console.error("SHOW INCIDENTS ERROR:", err);
    return json(500, { message: "Server error", error: err.message }, event);
  }
};

