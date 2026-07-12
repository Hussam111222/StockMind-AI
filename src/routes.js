const express = require("express");
const db = require("./db");
const { refreshAll } = require("./scheduler");
const { adminToken } = require("./config");

const router = express.Router();

// GET /api/dashboard — the two headline lists: rising signals vs caution/avoid signals
router.get("/dashboard", (req, res) => {
  const stocks = db.getAllStocks();
  const sorted = [...stocks].sort((a, b) => b.composite - a.composite);
  res.json({
    lastRun: db.getLastRun(),
    rising: sorted.filter((s) => s.classification === "rising"),
    caution: sorted.filter((s) => s.classification === "caution").sort((a, b) => a.composite - b.composite),
    neutral: sorted.filter((s) => s.classification === "neutral"),
    disclaimer:
      "Buy/avoid reads are computed from today's price/technical data and news sentiment for your personal watchlist. They are same-day reads, not guaranteed predictions — the final call is always yours.",
  });
});

// GET /api/stocks/:ticker — full detail for one stock
router.get("/stocks/:ticker", (req, res) => {
  const stock = db.getStock(req.params.ticker.toUpperCase());
  if (!stock) return res.status(404).json({ error: "Ticker not found in watchlist or not yet refreshed." });
  res.json(stock);
});

// POST /api/refresh — manually trigger the daily job (protected by a shared-secret token)
router.post("/refresh", async (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token !== adminToken) return res.status(401).json({ error: "Invalid admin token." });
  try {
    const results = await refreshAll();
    res.json({ ok: true, refreshed: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
