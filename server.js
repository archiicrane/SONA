const express = require("express");
const path = require("path");

const sonaHandler = require("./api/sona");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.text({ type: ["text/plain", "application/x-www-form-urlencoded"] }));
app.use(express.static(path.join(__dirname, "public")));

app.all("/api/arduino", (req, res) => {
  req.query = { ...(req.query || {}), route: "arduino" };
  return sonaHandler(req, res);
});

app.all("/api/history", (req, res) => {
  req.query = { ...(req.query || {}), route: "history" };
  return sonaHandler(req, res);
});

app.all("/api/clear", (req, res) => {
  req.query = { ...(req.query || {}), route: "clear" };
  return sonaHandler(req, res);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/history", (req, res) => {
  res.redirect(302, "/history.html");
});

app.get("/raw", (req, res) => {
  res.redirect(302, "/raw.html");
});

app.listen(PORT, () => {
  console.log(`[SONA] Server running at http://localhost:${PORT}`);
});
