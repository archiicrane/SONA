const store = require("./_lib/sonaStore");

module.exports = function clearHandler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    store.clearHistory();
    console.log("[SONA] History cleared via /api/clear");
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[SONA] /api/clear failed:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
};
