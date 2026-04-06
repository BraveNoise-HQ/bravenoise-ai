import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// 🔐 ENV VARIABLES
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

// 🧠 MEMORY (light)
let conversationHistory = [];

// 🔒 TOKEN CONTROL
let dailyTokenUsage = 0;
const DAILY_TOKEN_LIMIT = 20000;

// 🎨 DESIGN RULES
let designSpecs = "Minimalist, bold typography, clean layout.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch {}

// 🤖 GROQ API
async function askGroq(prompt, maxTokens = 500) {
  try {
    const estimatedTokens = prompt.length / 4;

    if (dailyTokenUsage + estimatedTokens > DAILY_TOKEN_LIMIT) {
      console.log("⚠️ Token limit reached");
      return "⚠️ Daily AI limit reached.";
    }

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          ...conversationHistory,
          { role: "user", content: prompt }
        ],
        max_tokens: maxTokens,
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const reply = response.data.choices?.[0]?.message?.content || "";
    dailyTokenUsage += estimatedTokens;

    conversationHistory.push({ role: "user", content: prompt });
    conversationHistory.push({ role: "assistant", content: reply });
    conversationHistory = conversationHistory.slice(-4);

    return reply;

  } catch (err) {
    console.error("Groq Error:", err.response?.data || err.message);
    return "⚠️ AI error.";
  }
}

// 🧠 SAFE JSON PARSER
function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// 📊 MARKET RESEARCH
async function performMarketResearch() {
  const prompt = `
Find ONE profitable, low-competition t-shirt niche right now.
Return ONE short phrase only.
`;

  const result = await askGroq(prompt, 100);
  return result?.trim() || "minimalist stoic quotes";
}

// 🎯 PRODUCT DATA
async function generateProductData(niche) {
  const prompt = `
Create Etsy listing JSON for niche: "${niche}"

Return ONLY JSON:
{
  "title": "...",
  "description": "...",
  "tags": ["","","","","","","","","",""]
}

STYLE: ${designSpecs}
`;

  const raw = await askGroq(prompt, 800);
  const parsed = extractJSON(raw);

  if (!parsed || !parsed.title) {
    throw new Error("Invalid AI JSON output");
  }

  return parsed;
}

// 🖼 GET IMAGE
async function getLatestImage() {
  const res = await axios.get(
    "https://api.printify.com/v1/uploads.json?limit=1",
    {
      headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
    }
  );

  return res.data.data?.[0]?.id;
}

// 📤 SEND MESSAGE TO SLACK
async function sendSlackMessage(text, channel) {
  await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, text },
    {
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// 🛒 CREATE PRODUCT FLOW
async function createProduct(channel) {
  try {
    await sendSlackMessage("📊 Researching market...", channel);
    const niche = await performMarketResearch();

    await sendSlackMessage(`🎯 Niche: *${niche}*`, channel);

    const product = await generateProductData(niche);

    await sendSlackMessage(`📝 Title:\n${product.title}`, channel);

    const imageId = await getLatestImage();
    if (!imageId) throw new Error("No image found.");

    await sendSlackMessage("✅ Product ready (listing + design).", channel);

  } catch (err) {
    console.error(err);
    await sendSlackMessage("❌ Error creating product.", channel);
  }
}

// 🔥 SLACK EVENTS ENDPOINT
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  // Slack verification
  if (body.type === "url_verification") {
    return res.send(body.challenge);
  }

  // Message handling
  if (body.event && body.event.type === "message" && !body.event.bot_id) {
    const text = body.event.text;
    const channel = body.event.channel;

    console.log("📩 Slack message:", text);

    if (text.toLowerCase().includes("create product")) {
      await createProduct(channel);
    } else {
      const reply = await askGroq(text);
      await sendSlackMessage(reply, channel);
    }
  }

  res.sendStatus(200);
});

// 🧪 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("🚀 Ben is alive");
});

// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`⚡ Server running on port ${PORT}`);
});
