const fs = require("fs");
const cron = require("node-cron");
const { watchlistPath, refreshCron, newsCron } = require("./config");
const { getDailySeries } = require("./dataProvider");
const { sma, rsi, momentum, trendCross } = require("./indicators");
const { analyzeNews, analyzeTechnicals } = require("./aiAnalyzer");
const { advanceModel } = require("./mlModel");
const { computeComposite } = require("./scoring");
const db = require("./db");

function loadWatchlist() {
  return JSON.parse(fs.readFileSync(watchlistPath, "utf8"));
}

async function refreshTicker(entry) {
  const { ticker, name, sector } = entry;
  console.log(`[refresh] ${ticker} — fetching price series…`);
  const { series, source } = await getDailySeries(ticker);

  const last = series[series.length - 1];
  const prev = series[series.length - 2] || last;
  const { sma50, sma200, signal: trendSignal } = trendCross(series);

  const baseSnapshot = {
    ticker,
    name,
    sector,
    last: last.close,
    change: Number((last.close - prev.close).toFixed(2)),
    changePct: Number((((last.close - prev.close) / prev.close) * 100).toFixed(2)),
    rsi: rsi(series),
    sma50,
    sma200,
    trendSignal,
    momentum20: momentum(series, 20),
    priceSource: source,
    series: series.slice(-120), // keep payload small
  };

  console.log(`[refresh] ${ticker} — searching news…`);
  let news;
  try {
    news = await analyzeNews(ticker, name, sector);
  } catch (err) {
    console.error(`[refresh] ${ticker} — news analysis failed:`, err.message);
    news = { newsSentiment: "Quiet", summary: "News read unavailable today.", headlines: [] };
  }

  const withNews = {
    ...baseSnapshot,
    newsSentiment: news.newsSentiment,
    newsSummary: news.summary,
    headlines: news.headlines || [],
  };

  console.log(`[refresh] ${ticker} — advancing statistical model…`);
  const priorModelState = await db.getModelState(ticker);
  const { modelState, prediction } = advanceModel(series, priorModelState);
  await db.setModelState(ticker, modelState);

  const withMl = { ...withNews, mlPrediction: prediction };

  const score = computeComposite(withMl);

  console.log(`[refresh] ${ticker} — composing AI narrative…`);
  let narrative;
  try {
    narrative = await analyzeTechnicals(withMl);
  } catch (err) {
    console.error(`[refresh] ${ticker} — narrative failed:`, err.message);
    narrative = { summary: "AI narrative unavailable today.", factors: [] };
  }

  const snapshot = {
    ...withMl,
    ...score,
    aiSummary: narrative.summary,
    aiFactors: narrative.factors || [],
    updatedAt: new Date().toISOString(),
  };

  await db.upsertStock(ticker, snapshot);
  console.log(`[refresh] ${ticker} — done. composite=${score.composite} (${score.classification})`);
  return snapshot;
}

async function refreshAll() {
  const watchlist = loadWatchlist();
  console.log(`[refresh] starting daily refresh for ${watchlist.length} tickers…`);
  const results = [];
  for (const entry of watchlist) {
    try {
      results.push(await refreshTicker(entry));
    } catch (err) {
      console.error(`[refresh] ${entry.ticker} failed entirely:`, err.message);
    }
  }
  await db.setLastRun(new Date().toISOString());
  console.log(`[refresh] daily refresh complete: ${results.length}/${watchlist.length} tickers updated.`);
  return results;
}

// Lighter intraday pass: re-check news and rescore, WITHOUT re-fetching prices or touching
// the ML model (daily price bars don't change intraday anyway, and the ML model should only
// advance once per day — this just keeps the news read current between full refreshes).
async function refreshNewsOnly(entry) {
  const { ticker, name, sector } = entry;
  const existing = db.getStock(ticker);
  if (!existing) {
    console.log(`[news-refresh] ${ticker} — no prior full refresh yet, skipping (run the daily job first).`);
    return null;
  }

  console.log(`[news-refresh] ${ticker} — checking for newer news…`);
  let news;
  try {
    news = await analyzeNews(ticker, name, sector);
  } catch (err) {
    console.error(`[news-refresh] ${ticker} — news check failed:`, err.message);
    return existing;
  }

  const updated = {
    ...existing,
    newsSentiment: news.newsSentiment,
    newsSummary: news.summary,
    headlines: news.headlines || [],
  };

  const score = computeComposite(updated);

  let narrative;
  try {
    narrative = await analyzeTechnicals(updated);
  } catch (err) {
    console.error(`[news-refresh] ${ticker} — narrative refresh failed, keeping previous:`, err.message);
    narrative = { summary: existing.aiSummary, factors: existing.aiFactors };
  }

  const snapshot = {
    ...updated,
    ...score,
    aiSummary: narrative.summary,
    aiFactors: narrative.factors || [],
    updatedAt: new Date().toISOString(),
    lastNewsCheck: new Date().toISOString(),
  };

  await db.upsertStock(ticker, snapshot);
  console.log(`[news-refresh] ${ticker} — done. composite=${score.composite} (${score.classification})`);
  return snapshot;
}

async function refreshAllNewsOnly() {
  const watchlist = loadWatchlist();
  console.log(`[news-refresh] starting intraday news check for ${watchlist.length} tickers…`);
  for (const entry of watchlist) {
    try {
      await refreshNewsOnly(entry);
    } catch (err) {
      console.error(`[news-refresh] ${entry.ticker} failed entirely:`, err.message);
    }
  }
  console.log(`[news-refresh] intraday news check complete.`);
}

function startScheduler() {
  console.log(`[scheduler] daily full refresh scheduled with cron "${refreshCron}"`);
  cron.schedule(refreshCron, () => {
    refreshAll().catch((err) => console.error("[scheduler] daily refresh run failed:", err));
  });

  console.log(`[scheduler] intraday news refresh scheduled with cron "${newsCron}"`);
  cron.schedule(newsCron, () => {
    refreshAllNewsOnly().catch((err) => console.error("[scheduler] news refresh run failed:", err));
  });
}

// Allow `npm run refresh` (node src/scheduler.js --once) to trigger a manual run from the CLI
if (require.main === module && process.argv.includes("--once")) {
  refreshAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

if (require.main === module && process.argv.includes("--news-once")) {
  refreshAllNewsOnly()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { startScheduler, refreshAll, refreshAllNewsOnly };
