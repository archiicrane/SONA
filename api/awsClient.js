// AWS SDK v3 client for DynamoDB
const { DynamoDBClient, ScanCommand, QueryCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.SONA_TABLE || "SONA_DB";

const client = new DynamoDBClient({ region: REGION });

async function getLatestReadings() {
  // Scan for latest reading per sensor_id
  const params = {
    TableName: TABLE_NAME,
    // Use a GSI or scan and filter in-memory for demo
  };
  const data = await client.send(new ScanCommand(params));
  const items = data.Items ? data.Items.map(unmarshall) : [];
  // Group by sensor_id, pick latest
  const latest = {};
  for (const item of items) {
    if (!item.sensor_id || !item.timestamp) continue;
    if (!latest[item.sensor_id] || item.timestamp > latest[item.sensor_id].timestamp) {
      latest[item.sensor_id] = item;
    }
  }
  return Object.values(latest);
}

async function getHistory(sensor, range) {
  // For demo, scan and filter in-memory
  const params = {
    TableName: TABLE_NAME,
  };
  const data = await client.send(new ScanCommand(params));
  let items = data.Items ? data.Items.map(unmarshall) : [];
  if (sensor) items = items.filter((x) => x.sensor_id === sensor);
  // Range: hour/day/month
  // For now, just return all
  return items;
}

async function getRaw(limit = 100) {
  const params = {
    TableName: TABLE_NAME,
  };
  const data = await client.send(new ScanCommand(params));
  let items = data.Items ? data.Items.map(unmarshall) : [];
  items = items.sort((a, b) => b.timestamp - a.timestamp);
  return items.slice(0, limit);
}

module.exports = { getLatestReadings, getHistory, getRaw };
