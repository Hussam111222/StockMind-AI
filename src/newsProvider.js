const { finnhubApiKey } = require("./config");

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// Real, structured company news (headline, source, url, timestamp, summary) for the
// last `daysBack` days. Returns null if no key is configured (caller should fall back
// to live web search), or [] if the key works but there's simply no recent news.
async function fetchFinnhubNews(ticker, daysBack = 2) {
  if (!finnhubApiKey) return null;

  const to = new Date();
  const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${fmtDate(from)}&to=${fmtDate(
    to
  )}&token=${finnhubApiKey}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub request failed (${res.status})`);
  const json = await res.json();
  if (!Array.isArray(json)) return [];

  return json.slice(0, 8).map((item) => ({
    headline: item.headline,
    source: item.source,
    url: item.url,
    datetime: item.datetime ? new Date(item.datetime * 1000).toISOString() : null,
    summary: item.summary,
  }));
}

module.exports = { fetchFinnhubNews };
