// SONA Ingest Lambda — paste this into the AWS Lambda console (sona-ingest function)
// Runtime: Node.js 18.x
// Handler: index.handler  (rename file to index.js when uploading)
//
// Required IAM permission on this function's role:
//   s3:GetObject, s3:PutObject on arn:aws:s3:::sona-sensor-data/*

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
const BUCKET = "sona-sensor-data";
const KEY = "latest.json";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  // Validate required fields
  const { sensor_id, sound_db, distance_cm, timestamp } = body;
  if (!sensor_id || sound_db === undefined || distance_cm === undefined || !timestamp) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Missing required fields: sensor_id, sound_db, distance_cm, timestamp" }),
    };
  }

  // Determine state from sound_db
  const db = Number(sound_db);
  const state = db >= 70 ? "loud" : db >= 50 ? "medium" : "quiet";

  const reading = {
    sensor_id,
    sound_db: db,
    distance_cm: Number(distance_cm),
    timestamp: Number(timestamp),
    state: body.state || state,
    // Preserve direction fields from ESP32 if present
    direction_label: body.direction_label ?? null,
    direction_angle_deg: body.direction_angle_deg != null ? Number(body.direction_angle_deg) : null,
    direction_confidence: body.direction_confidence != null ? Number(body.direction_confidence) : null,
    strongest_sensor: body.strongest_sensor ?? null,
    estimated_direction_distance_cm: body.estimated_direction_distance_cm != null ? Number(body.estimated_direction_distance_cm) : null,
  };

  // Load existing latest.json (so we preserve other sensors' data)
  let current = {};
  try {
    const existing = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }));
    const text = await existing.Body.transformToString();
    current = JSON.parse(text);
  } catch {
    // File doesn't exist yet — start fresh
  }

  // Update this sensor's reading
  current[sensor_id] = reading;

  // Write back to S3
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: KEY,
      Body: JSON.stringify(current),
      ContentType: "application/json",
    })
  );

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ ok: true, sensor_id, state }),
  };
};
