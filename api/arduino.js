let latestData = {
  sona1: { sound: 0, distance: 0, updatedAt: 0 },
  sona2: { sound: 0, distance: 0, updatedAt: 0 },
  sona3: { sound: 0, distance: 0, updatedAt: 0 }
};

export default function handler(req, res) {
  if (req.method === "POST") {
    const { sensor, sound, distance } = req.body || {};

    if (!sensor) {
      return res.status(400).json({ error: "Missing sensor id" });
    }

    latestData[sensor] = {
      sound: Number(sound) || 0,
      distance: Number(distance) || 0,
      updatedAt: Date.now()
    };

    return res.status(200).json({ status: "received", sensor });
  }

  if (req.method === "GET") {
    return res.status(200).json(latestData);
  }

  res.status(405).end();
}