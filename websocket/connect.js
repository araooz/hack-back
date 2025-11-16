const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const { decodeAndVerifyJWT } = require("../utils/jwt");

const ddb = new DynamoDBClient({});

exports.handler = async (event) => {
    const token = event.queryStringParameters?.token;
    if (!token) return { statusCode: 401, body: "Missing token" };
    let payload;
    try {
        payload = decodeAndVerifyJWT(token);
    } catch (err) {
        console.error("JWT ERROR:", err);
        return { statusCode: 401, body: "Invalid token" };
    }

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
