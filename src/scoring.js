const NEWS_SCORE = { Positive: 100, Mixed: 0, Quiet: 0, Negative: -100 };

// Technical sub-score in roughly [-100, 100], built from three independent, explainable signals.
function technicalScore({ rsi, trendSignal, momentum20 }) {
  // RSI: reward mid-range/rising momentum, penalize overbought/oversold extremes symmetrically
  let rsiScore = 0;
  if (rsi >= 45 && rsi <= 65) rsiScore = 40;
  else if (rsi > 65 && rsi <= 75) rsiScore = 15;
  else if (rsi >= 35 && rsi < 45) rsiScore = 15;
  else if (rsi > 75) rsiScore = -40; // overbought
  else if (rsi < 35) rsiScore = -40; // oversold / weak

  const trendScore = trendSignal === "golden" ? 35 : trendSignal === "death" ? -35 : 0;

  const momentumScore = Math.max(-25, Math.min(25, momentum20));

  return rsiScore + trendScore + momentumScore;
}

// ML sub-score in [-100, 100] — derived from the logistic model's probability, not a
// separate opinion. A probability of 0.5 (coin flip) contributes 0.
function mlScoreOf(mlPrediction) {
  if (!mlPrediction || typeof mlPrediction.probability !== "number") return 0;
  return Math.round((mlPrediction.probability - 0.5) * 200);
}

function classify(composite) {
  if (composite >= 30) return "rising";
  if (composite <= -30) return "caution";
  return "neutral";
}

function computeComposite(snapshot) {
  const tScore = technicalScore(snapshot);
  const nScore = NEWS_SCORE[snapshot.newsSentiment] ?? 0;
  const mScore = mlScoreOf(snapshot.mlPrediction);
  // weighted: technicals still lead, ML and news each contribute a meaningful but bounded share
  const composite = Math.round(tScore * 0.55 + nScore * 0.25 + mScore * 0.2);
  return {
    technicalScore: Math.round(tScore),
    newsScore: nScore,
    mlScore: mScore,
    composite,
    classification: classify(composite),
  };
}

module.exports = { computeComposite };
