const store = require("./_lib/sonaStore");

function resolveRoute(req) {
  const fromQuery = req.query && req.query.route;
  if (typeof fromQuery === "string" && fromQuery) {
    return fromQuery;
  }

  const pathname = String(req.url || "").split("?")[0] || "";
  if (pathname.endsWith("/arduino")) return "arduino";
  if (pathname.endsWith("/history")) return "history";
  if (pathname.endsWith("/clear")) return "clear";

  return null;
}

module.exports = function sonaHandler(req, res) {
  try {
    const route = resolveRoute(req);
    console.log(`[SONA] API request ${req.method} ${req.url} -> route=${route || "unknown"}`);

    if (route === "arduino") {
      if (req.method === "GET") {
        return res.status(200).json({ latest: store.getLatest() });
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
    }

    if (route === "history") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }

      const data = store.getHistory({
        sensor: req.query && req.query.sensor,
        limit: req.query && req.query.limit,
        order: req.query && req.query.order
      });

      return res.status(200).json({ ok: true, ...data });
    }

    if (route === "clear") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }

      store.clearHistory();
      console.log("[SONA] History cleared via /api/clear");
      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ ok: false, error: "Unknown API route" });
  } catch (error) {
    console.error("[SONA] /api/sona failed:", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
};
