const express = require("express");
const path = require("path");

const arduinoHandler = require("./api/arduino");
const historyHandler = require("./api/history");
const clearHandler = require("./api/clear");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.all("/api/arduino", (req, res) => arduinoHandler(req, res));
app.all("/api/history", (req, res) => historyHandler(req, res));
app.all("/api/clear", (req, res) => clearHandler(req, res));

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
