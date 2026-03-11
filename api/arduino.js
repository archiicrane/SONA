let latestData = {
  sound_db: 0,
  distance_cm: 0,
  sound_state: "quiet",
  led: false
};

export default function handler(req, res) {
  if (req.method === "POST") {
    latestData = req.body;
    return res.status(200).json({ status: "received" });
  }

  if (req.method === "GET") {
    return res.status(200).json(latestData);
  }

  res.status(405).end();
}