const { sma, rsiAt } = require("./indicators");

/*
  What this is, honestly:
  - A logistic regression classifier predicting P(tomorrow's close > today's close)
    from a handful of technical features.
  - It trains on the ticker's own price history, then does ONE online gradient step
    per day using yesterday's prediction vs. what actually happened — that's the
    "learns from its mistakes" part: a real (if simple) incremental-learning update,
    not a canned narrative.
  - What this is NOT: a hedge-fund-grade quant model. Short-horizon stock direction is
    famously close to a coin flip even for sophisticated models — treat the accuracy
    numbers this module reports as the honest ceiling of what to expect, not a sales pitch.
*/

const FEATURES = 4; // rsiNorm, momentum20Norm, smaGapNorm, todayReturnNorm
const LEARNING_RATE = 0.05;
const TRAIN_EPOCHS = 250;

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function featuresAt(series, index) {
  if (index < 55 || index >= series.length) return null; // need warmup room for sma50
  const rsiVal = rsiAt(series, 14, index);
  const past = series[index - 20] ? series[index - 20].close : series[index].close;
  const momentum20 = ((series[index].close - past) / past) * 100;
  const s50 = sma(series, 50, index);
  const s10 = sma(series, 10, index);
  const smaGap = s50 ? ((s10 - s50) / s50) * 100 : 0;
  const prevClose = series[index - 1].close;
  const todayReturn = ((series[index].close - prevClose) / prevClose) * 100;

  return [
    Math.max(-1, Math.min(1, (rsiVal - 50) / 50)),
    Math.max(-1, Math.min(1, momentum20 / 20)),
    Math.max(-1, Math.min(1, smaGap / 10)),
    Math.max(-1, Math.min(1, todayReturn / 5)),
  ];
}

function labelAt(series, index) {
  // 1 if the NEXT close is higher than this close, else 0
  if (index + 1 >= series.length) return null;
  return series[index + 1].close > series[index].close ? 1 : 0;
}

function initWeights() {
  return { w: new Array(FEATURES).fill(0), b: 0 };
}

function predict(weights, x) {
  const z = weights.w.reduce((sum, wi, i) => sum + wi * x[i], weights.b);
  return sigmoid(z);
}

function gradientStep(weights, x, y, lr = LEARNING_RATE) {
  const p = predict(weights, x);
  const error = p - y; // positive => predicted too high
  const newW = weights.w.map((wi, i) => wi - lr * error * x[i]);
  const newB = weights.b - lr * error;
  return { w: newW, b: newB };
}

// Full batch training from scratch over the ticker's own history — used the first time
// we see a ticker, or as a periodic reset if the model drifts badly.
function trainFromHistory(series) {
  let weights = initWeights();
  const samples = [];
  for (let i = 55; i < series.length - 1; i++) {
    const x = featuresAt(series, i);
    const y = labelAt(series, i);
    if (x && y !== null) samples.push({ x, y });
  }
  if (samples.length < 30) return { weights, trainedOn: samples.length };

  for (let epoch = 0; epoch < TRAIN_EPOCHS; epoch++) {
    for (const { x, y } of samples) {
      weights = gradientStep(weights, x, y, LEARNING_RATE);
    }
  }
  return { weights, trainedOn: samples.length };
}

/**
 * Advance the model by one day:
 * 1. If we had a pending prediction from the last run, score it against what actually
 *    happened and take one online gradient step (this is the "learning" part).
 * 2. Produce today's prediction for tomorrow's direction.
 *
 * `modelState` shape: { weights: {w,b}, history: [{date, predictedProb, predictedDirection, actualDirection, correct}], trainedOn }
 */
function advanceModel(series, modelState) {
  let state = modelState;
  if (!state || !state.weights) {
    const { weights, trainedOn } = trainFromHistory(series);
    state = { weights, history: [], trainedOn };
  }

  const lastIndex = series.length - 1;
  const prevIndex = lastIndex - 1;

  // Step 1 — grade yesterday's prediction against today's actual close, then learn from it
  if (state.pendingFeatureIndex !== undefined && state.pendingFeatureIndex === prevIndex) {
    const x = featuresAt(series, prevIndex);
    const actualUp = series[lastIndex].close > series[prevIndex].close ? 1 : 0;
    if (x) {
      state.weights = gradientStep(state.weights, x, actualUp, LEARNING_RATE);
      const correct = state.pendingDirection === (actualUp ? "up" : "down");
      state.history = [
        ...(state.history || []),
        {
          date: new Date().toISOString().slice(0, 10),
          predictedProb: state.pendingProb,
          predictedDirection: state.pendingDirection,
          actualDirection: actualUp ? "up" : "down",
          correct,
        },
      ].slice(-60); // keep a rolling window
    }
  }

  // Step 2 — predict tomorrow's direction from today's features
  const xToday = featuresAt(series, lastIndex);
  let prediction = { direction: "neutral", probability: 0.5 };
  if (xToday) {
    const prob = predict(state.weights, xToday);
    prediction = { direction: prob >= 0.5 ? "up" : "down", probability: prob };
    state.pendingFeatureIndex = lastIndex;
    state.pendingDirection = prediction.direction;
    state.pendingProb = prob;
  }

  const correctCount = (state.history || []).filter((h) => h.correct).length;
  const total = (state.history || []).length;
  const rollingAccuracy = total > 0 ? correctCount / total : null;

  return {
    modelState: state,
    prediction: {
      ...prediction,
      confidence: Math.round(Math.abs(prediction.probability - 0.5) * 200), // 0-100
      rollingAccuracy,
      sampleSize: total,
      trainedOn: state.trainedOn,
    },
  };
}

module.exports = { advanceModel, trainFromHistory, featuresAt };
