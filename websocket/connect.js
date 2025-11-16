exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 401, body: "Missing token" };

  const payload = decodeAndVerifyJWT(token);

  const item = {
    connectionId: { S: event.requestContext.connectionId },
    userId: { S: payload.userId },
    role: { S: payload.role },
    department: { S: payload.department || "none" },
    ttl: { N: String(Math.floor(Date.now() / 1000) + 86400) }
  };

  await ddb.send(new PutItemCommand({
    TableName: process.env.CONNECTIONS_TABLE,
    Item: item
  }));

  return { statusCode: 200 };
};
