require("dotenv").config();
const path = require("path");

module.exports = {
  port: process.env.PORT || 3000,

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  groqApiKey: process.env.GROQ_API_KEY || "",

  aiProvider:
    process.env.AI_PROVIDER ||
    (process.env.GROQ_API_KEY
      ? "groq"
      : process.env.GEMINI_API_KEY
      ? "gemini"
      : "anthropic"),

  alphaVantageKey: process.env.ALPHA_VANTAGE_KEY || "",
  finnhubApiKey: process.env.FINNHUB_API_KEY || "",

  refreshCron: process.env.REFRESH_CRON || "0 6 * * *",
  newsCron: process.env.NEWS_CRON || "0 */3 * * *",

  adminToken: process.env.ADMIN_TOKEN || "change-me",

  dbPath: path.join(__dirname, "..", "data", "db.json"),
  watchlistPath: path.join(__dirname, "..", "data", "watchlist.json"),
};
