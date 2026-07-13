const {
  anthropicApiKey,
  geminiApiKey,
  groqApiKey,
  aiProvider,
} = require("./config");

const { fetchFinnhubNews } = require("./newsProvider");

const GROQ_MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
];

const GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

let cachedGroqModel = null;
let cachedGeminiModel = null;

function parseJsonLoose(text) {
  const clean = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(clean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayFromError(errorText, fallbackMs = 15000) {
  const secondsMatch = errorText.match(
    /retry(?:ing)?(?:\s+in|\s+after)?\s+(\d+(?:\.\d+)?)\s*s/i
  );

  if (secondsMatch) {
    return Math.ceil(Number(secondsMatch[1]) * 1000) + 500;
  }

  const millisecondsMatch = errorText.match(
    /retry(?:ing)?(?:\s+in|\s+after)?\s+(\d+)\s*ms/i
  );

  if (millisecondsMatch) {
    return Number(millisecondsMatch[1]) + 500;
  }

  return fallbackMs;
}

async function callAnthropic({ prompt, useWebSearch }) {
  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  };

  if (useWebSearch) {
    body.tools = [
      {
        type: "web_search_20250305",
        name: "web_search",
      },
    ];
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

  return (data.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

async function callGroqModel(model, prompt) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Return only valid raw JSON. Do not use markdown code fences or add explanatory text.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_completion_tokens: 1000,
      response_format: {
        type: "json_object",
      },
    }),
  });
}

async function callGroq({ prompt }, attempt = 1) {
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const models = cachedGroqModel
    ? [cachedGroqModel]
    : GROQ_MODELS;

  let lastError = null;

  for (const model of models) {
    const res = await callGroqModel(model, prompt);

    if (res.status === 429) {
      const errorText = await res.text();

      if (attempt <= 3) {
        const delay = retryDelayFromError(errorText, 10000);

        console.log(
          `[aiAnalyzer] Groq rate limited. Retrying in ${Math.round(
            delay / 1000
          )} seconds (attempt ${attempt}/3).`
        );

        await sleep(delay);

        return callGroq({ prompt }, attempt + 1);
      }

      throw new Error(
        `Groq API error 429 after retries: ${errorText}`
      );
    }

    if (res.status === 404 || res.status === 400) {
      const errorText = await res.text();

      console.log(
        `[aiAnalyzer] Groq model "${model}" unavailable. Trying next model.`
      );

      lastError = new Error(
        `Groq API error ${res.status}: ${errorText}`
      );

      continue;
    }

    if (!res.ok) {
      throw new Error(
        `Groq API error ${res.status}: ${await res.text()}`
      );
    }

    const data = await res.json();
    const text =
      data.choices?.[0]?.message?.content?.trim() || "";

    if (!text) {
      throw new Error(
        `Groq model "${model}" returned an empty response.`
      );
    }

    cachedGroqModel = model;

    console.log(
      `[aiAnalyzer] Groq model "${model}" confirmed working.`
    );

    return text;
  }

  throw (
    lastError ||
    new Error("All configured Groq models are unavailable.")
  );
}

async function callGeminiModel(model, prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model}:generateContent?key=${geminiApiKey}`;

  return fetch(url, {
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
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });
}

async function callGemini({ prompt }, attempt = 1) {
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const models = cachedGeminiModel
    ? [cachedGeminiModel]
    : GEMINI_MODELS;

  let lastError = null;

  for (const model of models) {
    const res = await callGeminiModel(model, prompt);

    if (res.status === 429) {
      const errorText = await res.text();

      if (attempt <= 3) {
        const delay = retryDelayFromError(errorText, 15000);

        console.log(
          `[aiAnalyzer] Gemini rate limited. Retrying in ${Math.round(
            delay / 1000
          )} seconds (attempt ${attempt}/3).`
        );

        await sleep(delay);

        return callGemini({ prompt }, attempt + 1);
      }

      throw new Error(
        `Gemini API error 429 after retries: ${errorText}`
      );
    }

    if (res.status === 404) {
      const errorText = await res.text();

      console.log(
        `[aiAnalyzer] Gemini model "${model}" unavailable. Trying next model.`
      );

      lastError = new Error(
        `Gemini API error 404: ${errorText}`
      );

      continue;
    }

    if (!res.ok) {
      throw new Error(
        `Gemini API error ${res.status}: ${await res.text()}`
      );
    }

    const data = await res.json();

    const text = (
      data.candidates?.[0]?.content?.parts || []
    )
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!text) {
      throw new Error(
        `Gemini model "${model}" returned an empty response.`
      );
    }

    cachedGeminiModel = model;

    console.log(
      `[aiAnalyzer] Gemini model "${model}" confirmed working.`
    );

    return text;
  }

  throw (
    lastError ||
    new Error("All configured Gemini models are unavailable.")
  );
}

async function callAI({ prompt, useWebSearch }) {
  const errors = [];

  const providerOrder =
    aiProvider === "anthropic"
      ? ["anthropic", "groq", "gemini"]
      : aiProvider === "gemini"
        ? ["gemini", "groq", "anthropic"]
        : ["groq", "gemini", "anthropic"];

  for (const provider of providerOrder) {
    try {
      if (provider === "groq" && groqApiKey) {
        return await callGroq({ prompt });
      }

      if (provider === "gemini" && geminiApiKey) {
        return await callGemini({ prompt });
      }

      if (provider === "anthropic" && anthropicApiKey) {
        return await callAnthropic({
          prompt,
          useWebSearch,
        });
      }
    } catch (error) {
      errors.push(`${provider}: ${error.message}`);

      console.error(
        `[aiAnalyzer] ${provider} failed. Trying next configured provider:`,
        error.message
      );
    }
  }

  throw new Error(
    `All configured AI providers failed: ${errors.join(" | ")}`
  );
}

async function analyzeNews(ticker, name, sector) {
  let structured = null;

  try {
    structured = await fetchFinnhubNews(ticker);
  } catch (error) {
    console.error(
      `[aiAnalyzer] Finnhub news fetch failed for ${ticker}:`,
      error.message
    );
  }

  const hasStructured =
    Array.isArray(structured) && structured.length > 0;

  const canWebSearch =
    aiProvider === "anthropic" && Boolean(anthropicApiKey);

  const useWebSearch =
    !hasStructured && canWebSearch;

  let sourceBlock;

  if (hasStructured) {
    sourceBlock =
      `Here is real structured recent news from a financial news API. ` +
      `Base the analysis only on this data and do not invent information:\n` +
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
      `Search for the most recent news from the last 24 to 48 hours about ${ticker}.`;
  } else {
    sourceBlock =
      `There is no live news feed available for this run. ` +
      `Do not invent headlines. Set "newsSentiment" to "Quiet", ` +
      `use an honest summary, and return an empty "headlines" array.`;
  }

  const prompt = `Analyze recent news for ${ticker} (${name}, ${sector} sector).

${sourceBlock}

Respond with only valid raw JSON matching exactly this structure:
{
  "newsSentiment": "Positive",
  "summary": "One or two plain-language sentences.",
  "headlines": [
    {
      "title": "Short headline paraphrase",
      "source": "Publication name",
      "note": "One short sentence explaining why it matters"
    }
  ]
}

The only valid newsSentiment values are:
"Positive", "Negative", "Mixed", or "Quiet".

Include up to five headlines.`;

  const text = await callAI({
    prompt,
    useWebSearch,
  });

  return parseJsonLoose(text);
}

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
      ? `The statistical model predicts ${ml.direction} with confidence ${ml.confidence}/100. Its rolling accuracy over the last ${ml.sampleSize} predictions is ${(ml.rollingAccuracy * 100).toFixed(0)}%.`
      : `The statistical model predicts ${ml.direction} with confidence ${ml.confidence}/100. There is not enough prediction history yet to report rolling accuracy.`;

  const prompt = `Analyze this stock snapshot and explain why it currently reads as "${stance}".

Do not guarantee future performance. Use the specific figures provided.

Ticker: ${snapshot.ticker}
Company: ${snapshot.name}
Sector: ${snapshot.sector}
Last close: ${snapshot.last}
RSI(14): ${snapshot.rsi.toFixed(1)}
SMA50: ${
    snapshot.sma50
      ? snapshot.sma50.toFixed(2)
      : "n/a"
  }
SMA200: ${
    snapshot.sma200
      ? snapshot.sma200.toFixed(2)
      : "n/a"
  }
Trend cross: ${snapshot.trendSignal}
20-day momentum: ${snapshot.momentum20.toFixed(2)}%
News sentiment: ${snapshot.newsSentiment}
News summary: ${snapshot.newsSummary}
${mlLine}
Composite classification: ${snapshot.classification}

Respond with only valid raw JSON matching exactly this structure:
{
  "summary": "Two or three sentences explaining the current read.",
  "factors": [
    {
      "label": "Momentum",
      "note": "One specific sentence using the actual momentum figure"
    },
    {
      "label": "Trend",
      "note": "One specific sentence using the SMA or RSI figures"
    },
    {
      "label": "Statistical model",
      "note": "One specific sentence about the model prediction and track record"
    },
    {
      "label": "News & risk",
      "note": "One specific sentence"
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
