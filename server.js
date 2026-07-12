const express = require("express");
const cors = require("cors");
const path = require("path");
const { port } = require("./src/config");
const routes = require("./src/routes");
const { startScheduler } = require("./src/scheduler");

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", routes);
app.use(express.static(path.join(__dirname, "public")));

app.listen(port, () => {
  console.log(`StockMind AI backend listening on http://localhost:${port}`);
  console.log(`Dashboard: http://localhost:${port}/`);
  startScheduler();
  console.log(`Tip: run "npm run refresh" once now to populate data instead of waiting for the cron job.`);
});
