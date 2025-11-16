const {
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand
} = require("@aws-sdk/client-dynamodb");

const {
  ApiGatewayManagementApi
} = require("@aws-sdk/client-apigatewaymanagementapi");

const ddb = new DynamoDBClient({});

exports.broadcastIncident = async (incident) => {
  const domain = process.env.WS_DOMAIN;    // e.g. r4b9gpszvi.execute-api.us-east-1.amazonaws.com
  const stage = process.env.WS_STAGE;      // e.g. dev

  if (!domain || !stage) {
    console.error("Missing WS_DOMAIN or WS_STAGE env vars", {
      domain,
      stage
    });
    return;
  }

  // IMPORTANT: ApiGatewayManagementApi expects *NO https://*
  const endpoint = `${domain}/${stage}`;

  console.log("WS MGMT ENDPOINT:", endpoint);

  const ws = new ApiGatewayManagementApi({
    endpoint,
    region: process.env.AWS_REGION || "us-east-1"
  });

  // Load all websocket connections
  const conns = await ddb.send(new ScanCommand({
    TableName: process.env.CONNECTIONS_TABLE
  }));

  for (const c of conns.Items) {
    const role = c.role.S;
    const department = c.department.S;

    const isWorker = role === "worker";
    if (isWorker && department !== incident.category) continue;

    const connectionId = c.connectionId.S;

    try {
      await ws.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify(incident)
      });

    } catch (err) {
      // 410 Gone → stale connection
      if (err.$metadata && err.$metadata.httpStatusCode === 410) {
        console.log("Deleting stale connection:", connectionId);

        await ddb.send(new DeleteItemCommand({
          TableName: process.env.CONNECTIONS_TABLE,
          Key: { connectionId: { S: connectionId } }
        }));

      } else {
        console.error("Broadcast error for", connectionId, err);
      }
    }
  }
};
