const fs = require("fs");
const { dbPath } = require("./config");

let writeQueue = Promise.resolve();

function ensureFile() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ stocks: {}, models: {}, lastRun: null }, null, 2));
  }
}

function readAll() {
  ensureFile();
  const raw = fs.readFileSync(dbPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.models) parsed.models = {};
    return parsed;
  } catch (e) {
    return { stocks: {}, models: {}, lastRun: null };
  }
}

function writeAll(data) {
  // queue writes so concurrent daily-refresh upserts never clobber each other
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(dbPath, JSON.stringify(data, null, 2), (err) => (err ? reject(err) : resolve()));
      })
  );
  return writeQueue;
}

async function upsertStock(ticker, snapshot) {
  const data = readAll();
  data.stocks[ticker] = snapshot;
  await writeAll(data);
}

async function setLastRun(iso) {
  const data = readAll();
  data.lastRun = iso;
  await writeAll(data);
}

function getStock(ticker) {
  const data = readAll();
  return data.stocks[ticker] || null;
}

function getAllStocks() {
  const data = readAll();
  return Object.values(data.stocks);
}

function getLastRun() {
  return readAll().lastRun;
}

function getModelState(ticker) {
  const data = readAll();
  return data.models[ticker] || null;
}

async function setModelState(ticker, state) {
  const data = readAll();
  data.models[ticker] = state;
  await writeAll(data);
}

module.exports = { upsertStock, getStock, getAllStocks, getLastRun, setLastRun, getModelState, setModelState };
