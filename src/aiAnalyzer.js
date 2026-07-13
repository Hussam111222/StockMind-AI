const { anthropicApiKey, geminiApiKey, aiProvider } = require("./config");
const { fetchFinnhubNews } = require("./newsProvider");

function parseJsonLoose(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

async function callAnthropic({ prompt, useWebSearch }) {
  if (!anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — add it to .env, or switch AI_PROVIDER=gemini"
    );
  }

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  };

  if (useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `Anthropic API error ${res.status}: ${await res.text()}`
    );
  }

  const data = await res.json();

  return data.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

// Gemini free-tier pacing:
// ننتظر 13 ثانية بين كل طلب لتجنب تجاوز حد 5 طلبات بالدقيقة.
const MIN_INTERVAL_MS = 13000;
let lastCallAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paceGeminiCall() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();

  if (wait > 0) {
    await sleep(wait);
  }

  lastCallAt = Date.now();
}

function retryDelayFromError(errorText) {
  const match = errorText.match(/retry in (\d+(\.\d+)?)s/i);

  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000) + 500;
  }

  return MIN_INTERVAL_MS;
}

// Free-tier path — Gemini has no built-in live web search on the free tier,
// so callers must feed it structured data such as Finnhub headlines.
async function callGemini({ prompt }, attempt = 1) {
  if (!geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set — add it to .env, or switch AI_PROVIDER=anthropic"
    );
  }

  await paceGeminiCall();

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (res.status === 429 && attempt <= 3) {
    const errorText = await res.text();
    const delay = retryDelayFromError(errorText);

    console.log(
      `[aiAnalyzer] Gemini rate-limited, retrying in ${Math.round(
        delay / 1000
      )}s (attempt ${attempt}/3)…`
    );

    await sleep(delay);

    return callGemini({ prompt }, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(
      `Gemini API error ${res.status}: ${await res.text()}`
    );
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];

  return parts
    .map((part) => part.text || "")
    .join("")
    .trim();
}

async function callAI({ prompt, useWebSearch }) {
  if (aiProvider === "gemini") {
    return callGemini({ prompt });
  }

  return callAnthropic({ prompt, useWebSearch });
}

// Real news, either from a dedicated financial news API or Anthropic web search.
async function analyzeNews(ticker, name, sector) {
  let structured = null;

  try {
    structured = await fetchFinnhubNews(ticker);
  } catch (err) {
    console.error(
      `[aiAnalyzer] Finnhub news fetch failed for ${ticker}:`,
      err.message
    );
  }

  const hasStructured = structured && structured.length > 0;
  const canWebSearch = aiProvider === "anthropic";
  const useWebSearch = !hasStructured && canWebSearch;

  let sourceBlock;

  if (hasStructured) {
    sourceBlock =
      `Here is real, structured recent news pulled from a financial news API — ` +
      `base your analysis ONLY on this data, do not invent anything beyond it:\n` +
      structured
        .map(
          (news, index) =>
            `${index + 1}. [${news.source}] ${news.headline} — ${
              news.summary || ""
            }`
        )
        .join("\n");
  } else if (useWebSearch) {
    sourceBlock =
      `No structured news feed is configured — search the web for the most recent ` +
      `news (last 24-48 hours) about ${ticker}.`;
  } else {
    sourceBlock =
      `You have no live web access and no structured news feed for this run. ` +
      `Do NOT invent or guess at recent headlines. Set "newsSentiment" to "Quiet" ` +
      `and return an empty "headlines" array — it's fine and expected to say there's nothing to report today.`;
  }

  const prompt = `You are analyzing recent news for ${ticker} (${name}, ${sector} sector) stock.
${sourceBlock}

Then respond with ONLY raw JSON, no markdown fences, no preamble, matching exactly this shape:
{
  "newsSentiment": "Positive" | "Negative" | "Mixed" | "Quiet",
  "summary": "<one or two plain-language sentences synthesizing what the recent news means for the stock>",
  "headlines": [
    {
      "title": "<short headline paraphrase, not a verbatim quote>",
      "source": "<publication name>",
      "note": "<one short sentence on why it matters>"
    }
  ]
}
Include up to 5 headlines. If you find little to no recent news, set newsSentiment to "Quiet" and return an empty headlines array.`;

  const text = await callAI({
    prompt,
    useWebSearch,
  });

  return parseJsonLoose(text);
}

// Data-grounded narrative read for a personal watchlist tool.
async function analyzeTechnicals(snapshot) {
  const stance =
    snapshot.classification === "rising"
      ? "buy candidate"
      : snapshot.classification === "caution"
      ? "one to avoid for now"
      : "neutral / mixed";

  const ml = snapshot.mlPrediction || {};

  const mlLine =
    ml.sampleSize > 0
      ? `Statistical model predicts: ${ml.direction} (confidence ${
          ml.confidence
        }/100), and this model's own rolling accuracy over its last ${
          ml.sampleSize
        } predictions is ${(ml.rollingAccuracy * 100).toFixed(0)}%.`
      : `Statistical model predicts: ${ml.direction} (confidence ${ml.confidence}/100). Not enough history yet to report a rolling accuracy.`;

  const prompt = `You are a personal research assistant inside a single-user stock-watchlist tool. Analyze this data snapshot and explain clearly WHY the data currently reads as a "${stance}". Be direct and specific about the reasoning, but stay honest: this is a same-day read of technicals + news + a simple statistical model, not a guarantee, so don't claim certainty about future price moves. If the statistical model's rolling accuracy is low or close to 50%, say so plainly instead of oversell it.

Ticker: ${snapshot.ticker} (${snapshot.name}, ${snapshot.sector})
Last close: ${snapshot.last}
RSI(14): ${snapshot.rsi.toFixed(1)}
SMA50: ${snapshot.sma50 ? snapshot.sma50.toFixed(2) : "n/a"}
SMA200: ${snapshot.sma200 ? snapshot.sma200.toFixed(2) : "n/a"}
Trend cross: ${snapshot.trendSignal}
20-day momentum: ${snapshot.momentum20.toFixed(2)}%
News sentiment: ${snapshot.newsSentiment}
News summary: ${snapshot.newsSummary}
${mlLine}
Composite classification: ${snapshot.classification}

Respond with ONLY raw JSON, no markdown fences, no preamble:
{
  "summary": "<two to three sentences stating clearly why this reads as a ${stance} today, referencing the specific numbers above including the statistical model's read>",
  "factors": [
    {
      "label": "Momentum",
      "note": "<one specific sentence, cite the actual number>"
    },
    {
      "label": "Trend",
      "note": "<one specific sentence, cite SMA/RSI>"
    },
    {
      "label": "Statistical model",
      "note": "<one specific sentence on the model's prediction and its own track record>"
    },
    {
      "label": "News & risk",
      "note": "<one specific sentence>"
    }
  ]
}`;

  const text = await callAI({
    prompt,
    useWebSearch: false,
  });

  return parseJsonLoose(text);
}

module.exports = {
  analyzeNews,
  analyzeTechnicals,
};
