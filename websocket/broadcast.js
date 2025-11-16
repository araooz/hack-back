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
  const endpoint = process.env.WS_ENDPOINT;

  if (!endpoint) {
    console.error("Missing WS_ENDPOINT env var", { endpoint });
    return;
  }

  // This is the FULL URL, including https:// and /stage
  // Example: https://r4b9gpszvi.execute-api.us-east-1.amazonaws.com/dev
  console.log("WS MGMT ENDPOINT:", endpoint);

  // ApiGatewayManagementApi *can* accept a full https URL
  const ws = new ApiGatewayManagementApi({
    endpoint,
  });

  // Load all active websocket connections
  const conns = await ddb.send(
    new ScanCommand({
      TableName: process.env.CONNECTIONS_TABLE,
    })
  );

  for (const c of conns.Items) {
    const role = c.role.S;
    const department = c.department.S;

    // Workers only receive incidents matching their category
    if (role === "worker" && department !== incident.category) {
      continue;
    }

    const connectionId = c.connectionId.S;

    try {
      await ws.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify(incident),
      });

    } catch (err) {
      const status = err?.$metadata?.httpStatusCode;

      // 410 Gone → stale connection
      if (status === 410) {
        console.log("Deleting stale connection:", connectionId);

        await ddb.send(
          new DeleteItemCommand({
            TableName: process.env.CONNECTIONS_TABLE,
            Key: { connectionId: { S: connectionId } },
          })
        );
      } else {
        console.error("Broadcast error for", connectionId, err);
      }
    }
  }
};
