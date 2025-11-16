exports.handler = async (event) => {
  await ddb.send(new DeleteItemCommand({
    TableName: process.env.CONNECTIONS_TABLE,
    Key: { connectionId: { S: event.requestContext.connectionId } }
  }));

  return { statusCode: 200 };
};
