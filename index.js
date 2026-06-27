require("dotenv").config();
const axios = require("axios");
const TelegramBot =
  require("node-telegram-bot-api").default || require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const alerted = new Set();

async function fetchNewTokens() {
  try {
    const profilesRes = await axios.get(
      "https://api.dexscreener.com/token-profiles/latest/v1",
    );
    const profiles = (profilesRes.data || []).filter(
      (t) => t.chainId === "solana",
    );
    const tokens = [];
    for (const profile of profiles.slice(0, 20)) {
      try {
        const pairRes = await axios.get(
          "https://api.dexscreener.com/latest/dex/tokens/" +
            profile.tokenAddress,
        );
        const pair = pairRes.data?.pairs?.[0];
        if (pair) tokens.push({ ...pair, tokenAddress: profile.tokenAddress });
      } catch (e) {}
    }
    return tokens;
  } catch (err) {
    console.error("Fetch error:", err.message);
    return [];
  }
}

function passesFilter(token) {
  const chainId = token?.chainId || "";
  const volume = token?.volume?.h1 || 0;
  const liquidity = token?.liquidity?.usd || 0;
  const marketCap = token?.marketCap || 0;
  const buys = token?.txns?.h1?.buys || 0;

  if (chainId !== "solana") return false;
  if (volume < 5000) return false;
  if (buys < 20) return false;
  if (liquidity === 0 && marketCap < 30000) return false;
  if (liquidity > 0 && liquidity < 10000) return false;

  return true;
}

function scoreToken(token) {
  let score = 5;
  const volume = token?.volume?.h1 || 0;
  const buys = token?.txns?.h1?.buys || 0;
  const sells = token?.txns?.h1?.sells || 0;
  const priceChange = token?.priceChange?.h1 || 0;
  const liquidity = token?.liquidity?.usd || 0;
  const marketCap = token?.marketCap || 0;

  if (volume > 20000) score += 1;
  if (buys > sells) score += 1;
  if (priceChange > 10) score += 1;
  if (liquidity > 50000 || marketCap > 60000) score += 1;

  return Math.min(score, 10);
}

function getRiskLevel(score) {
  if (score >= 8) return "Low";
  if (score >= 6) return "Medium";
  return "High";
}

async function sendAlert(token) {
  const score = scoreToken(token);
  const risk = getRiskLevel(score);
  const liquidity = token?.liquidity?.usd || 0;
  const platform = liquidity === 0 ? "Pump.fun" : "Raydium";
  const ageMs = Date.now() - (token?.pairCreatedAt || 0);
  const ageMin = Math.floor(ageMs / 60000);

  const message = [
    "NEW TOKEN ALERT",
    "",
    "Name: " + (token.baseToken?.name || "Unknown"),
    "Ticker: $" + (token.baseToken?.symbol || "N/A"),
    "Contract: " + (token.tokenAddress || token.pairAddress || "N/A"),
    "Chain: Solana",
    "Platform: " + platform,
    "",
    "-----------------",
    "METRICS",
    "Market Cap: $" + (token?.marketCap || 0).toLocaleString(),
    "Liquidity: $" + liquidity.toLocaleString(),
    "Volume (1h): $" + (token?.volume?.h1 || 0).toLocaleString(),
    "Buys/Sells (1h): " +
      (token?.txns?.h1?.buys || 0) +
      "/" +
      (token?.txns?.h1?.sells || 0),
    "Price Change (1h): " + (token?.priceChange?.h1 || 0) + "%",
    "",
    "-----------------",
    "RISK LEVEL: " + risk,
    "SCORE: " + score + "/10",
    "",
    "-----------------",
    "ANALYSIS: Early signal detected. Monitor closely. Exit suggested at 3x-5x.",
    "",
    "-----------------",
    "Age: " + ageMin + " mins",
    "DexScreener: https://dexscreener.com/solana/" + token.pairAddress,
    "Rugcheck: https://rugcheck.xyz/tokens/" + (token.tokenAddress || ""),
  ].join("\n");

  await bot.sendMessage(CHAT_ID, message);
}

async function scan() {
  console.log("Scanning for new tokens...");
  const tokens = await fetchNewTokens();
  let passed = 0;

  for (const token of tokens) {
    const id = token.pairAddress || token.tokenAddress;
    if (!id || alerted.has(id)) continue;
    if (passesFilter(token)) {
      passed++;
      alerted.add(id);
      await sendAlert(token);
      console.log("Alert sent for $" + token.baseToken?.symbol);
    }
  }
  console.log(
    "Done. " + tokens.length + " checked, " + passed + " alerts sent.",
  );
}

scan();
setInterval(scan, 30000);
console.log("Memecoin bot started...");
