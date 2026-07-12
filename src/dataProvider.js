const { alphaVantageKey } = require("./config");

function seedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic simulated series — used only when no real data-provider key is configured.
function generateMockSeries(ticker, days = 260) {
  const rand = mulberry32(seedFromString(ticker));
  const basePrice = 50 + rand() * 400;
  const series = [];
  let price = basePrice;
  const drift = (rand() - 0.45) * 0.0012;
  for (let i = 0; i < days; i++) {
    const shock = (rand() - 0.5) * 0.028;
    price = Math.max(1, price * (1 + drift + shock));
    series.push({ date: i, close: Number(price.toFixed(2)), volume: Math.round(4_000_000 + rand() * 22_000_000) });
  }
  return { series, source: "mock" };
}

async function fetchAlphaVantageDaily(ticker) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
    ticker
  )}&outputsize=full&apikey=${alphaVantageKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage request failed (${res.status})`);
  const json = await res.json();
  const raw = json["Time Series (Daily)"];
  if (!raw) throw new Error(json.Note || json.Information || "Alpha Vantage returned no series (rate limit or bad symbol?)");
  const dates = Object.keys(raw).sort(); // ascending
  const series = dates.map((d, i) => ({
    date: d,
    close: Number(raw[d]["4. close"]),
    volume: Number(raw[d]["5. volume"]),
  }));
  return { series, source: "alpha_vantage" };
}

async function getDailySeries(ticker) {
  if (alphaVantageKey) {
    try {
      return await fetchAlphaVantageDaily(ticker);
    } catch (err) {
      console.error(`[dataProvider] Alpha Vantage failed for ${ticker}, falling back to mock:`, err.message);
      return generateMockSeries(ticker);
    }
  }
  return generateMockSeries(ticker);
}

module.exports = { getDailySeries };
