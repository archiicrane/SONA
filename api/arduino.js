const store = require("./_lib/sonaStore");

module.exports = function arduinoHandler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json({
        latest: store.getLatest()
      });
    }

    if (req.method === "POST") {
      const result = store.savePayload(req.body || {});

      if (!result.ok) {
        console.warn("[SONA] Rejected /api/arduino payload:", req.body);
        return res.status(400).json({ ok: false, error: result.error });
      }

      console.log(`[SONA] Saved ${result.entries.length} reading(s) from /api/arduino`);
      return res.status(200).json({
        ok: true,
        saved: result.entries.length,
        entries: result.entries,
        latest: store.getLatest()
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    console.error("[SONA] /api/arduino failed:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
};