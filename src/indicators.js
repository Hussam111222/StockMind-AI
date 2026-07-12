function sma(series, period, index = series.length - 1) {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) sum += series[i].close;
  return sum / period;
}

function rsiAt(series, period = 14, index = series.length - 1) {
  if (index + 1 < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  const start = index - period;
  for (let i = start + 1; i <= index; i++) {
    const delta = series[i].close - series[i - 1].close;
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function rsi(series, period = 14) {
  return rsiAt(series, period, series.length - 1);
}

// % change over the last N trading days
function momentum(series, days = 20) {
  if (series.length < days + 1) return 0;
  const last = series[series.length - 1].close;
  const past = series[series.length - 1 - days].close;
  return ((last - past) / past) * 100;
}

function trendCross(series) {
  const idx = series.length - 1;
  const s50 = sma(series, 50, idx);
  const s200 = sma(series, 200, idx);
  if (!s50 || !s200) return { sma50: s50, sma200: s200, signal: "insufficient-data" };
  return { sma50: s50, sma200: s200, signal: s50 > s200 ? "golden" : "death" };
}

module.exports = { sma, rsi, rsiAt, momentum, trendCross };
