const { ApiGatewayManagementApi } = require("@aws-sdk/client-apigatewaymanagementapi");

exports.broadcastIncident = async (incident) => {
  const ws = new ApiGatewayManagementApi({
    endpoint: process.env.WS_ENDPOINT
  });

  const conns = await ddb.send(new ScanCommand({
    TableName: process.env.CONNECTIONS_TABLE
  }));

  for (const c of conns.Items) {
    const role = c.role.S;
    const department = c.department.S;

    const isWorker = role === "worker";
    const isAdmin = role === "admin";

    if (isWorker && department !== incident.department) continue;

    const connectionId = c.connectionId.S;

    try {
      await ws.postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify(incident)
      });
    } catch (err) {
      if (err.statusCode === 410) {
        // Means gone: clean it
        await ddb.send(new DeleteItemCommand({
          TableName: process.env.CONNECTIONS_TABLE,
          Key: { connectionId: { S: connectionId } }
        }));
      }
    }
  }
};
