import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";
import cron from "node-cron";

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

// 🔄 GROQ MODELS (try first → fallback)
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

// 🤖 GROQ API CALL WITH FALLBACK
async function askGroq(prompt, maxTokens = 500) {
  let lastError = null;

  for (const model of GROQ_MODELS) {
    try {
      const estimatedTokens = prompt.length / 4;
      if (dailyTokenUsage + estimatedTokens > DAILY_TOKEN_LIMIT) {
        console.log("⚠️ Token limit reached");
        return "⚠️ Daily AI limit reached.";
      }

      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [
            ...conversationHistory,
            { role: "user", content: prompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.7
        },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } }
      );

      const reply = response.data.choices?.[0]?.message?.content || "";
      dailyTokenUsage += estimatedTokens;

      conversationHistory.push({ role: "user", content: prompt });
      conversationHistory.push({ role: "assistant", content: reply });
      conversationHistory = conversationHistory.slice(-4);

      return reply;

    } catch (err) {
      lastError = err;
      if (err.response?.data?.code === "model_permission_blocked_project") {
        console.warn(`⚠️ Model ${model} blocked, trying next...`);
        continue;
      } else {
        console.error("Groq Error:", err.response?.data || err.message);
        return "⚠️ AI error.";
      }
    }
  }

  console.error("All models blocked or failed:", lastError?.message);
  return "⚠️ No models available for your org.";
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

  if (!parsed || !parsed.title) throw new Error("Invalid AI JSON output");
  return parsed;
}

// 🖼 GET IMAGE
async function getLatestImage() {
  const res = await axios.get("https://api.printify.com/v1/uploads.json?limit=1", {
    headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
  });
  return res.data.data?.[0]?.id;
}

// 📤 SEND MESSAGE TO SLACK
async function sendSlackMessage(text, channel) {
  await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, text },
    { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" } }
  );
}

// 🛒 CREATE PRINTIFY PRODUCT
async function createPrintifyProduct(productData, imageId) {
  const payload = {
    title: productData.title,
    description: productData.description,
    blueprint_id: 12,          // T-shirt blueprint
    print_provider_id: 29,     // Provider ID
    variants: [{ variant_id: 4012, price: 25 }], // example variant
    images: [{ id: imageId }],
    tags: productData.tags
  };

  const res = await axios.post(
    `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
    payload,
    { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
  );

  return res.data;
}

// 🛠 FULL PRODUCT FLOW
async function createProduct(channel) {
  try {
    await sendSlackMessage("📊 Researching market...", channel);
    const niche = await performMarketResearch();
    await sendSlackMessage(`🎯 Niche: *${niche}*`, channel);

    const product = await generateProductData(niche);
    await sendSlackMessage(`📝 Title:\n${product.title}`, channel);

    const imageId = await getLatestImage();
    if (!imageId) throw new Error("No image found.");

    await sendSlackMessage("🖼 Creating product on Printify...", channel);
    const printifyResponse = await createPrintifyProduct(product, imageId);

    await sendSlackMessage(`✅ Product created! ID: ${printifyResponse.id}`, channel);

  } catch (err) {
    console.error(err);
    await sendSlackMessage("❌ Error creating product.", channel);
  }
}

// 🔁 SCHEDULED AUTOMATION (2x/day)
cron.schedule("0 10,16 * * *", async () => {
  console.log("⏰ Scheduled trigger: Creating product flow");
  const CHANNEL_ID = "YOUR_SLACK_CHANNEL_ID"; // replace with your Slack channel
  await createProduct(CHANNEL_ID);
});

// 🔥 SLACK EVENTS ENDPOINT
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  if (body.type === "url_verification") return res.send(body.challenge);

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
app.get("/", (req, res) => res.send("🚀 Ben is alive"));

// 🚀 START SERVER
app.listen(PORT, () => console.log(`⚡ Server running on port ${PORT}`));
