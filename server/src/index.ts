import "./env.js";
import express from "express";
import cors from "cors";
import { marketRouter } from "./routes/market.js";
import { portfolioRouter } from "./routes/portfolio.js";
import { aiRouter } from "./routes/ai.js";
import { uwRouter } from "./routes/uw.js";
import { getKey } from "./uw/client.js";
import { allStats } from "./providers/registry.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", marketRouter);
app.use("/api/portfolios", portfolioRouter);
app.use("/api/ai", aiRouter);
app.use("/api/uw", uwRouter);

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    providers: allStats(),
    ai: Boolean(process.env.ANTHROPIC_API_KEY),
    uw: Boolean(getKey().key),
  });
});

export { app };

if (process.env.NODE_ENV !== "test") {
  const PORT = Number(process.env.API_PORT ?? 4000);
  app.listen(PORT, () => {
    console.log(`RahnbergTerminal API listening on http://localhost:${PORT}`);
  });
}
