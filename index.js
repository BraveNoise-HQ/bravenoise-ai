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
      lastError = err;
      if (err.response?.data?.code === "model_permission_blocked_project") {
        console.warn(`⚠️ Model ${model} blocked, trying next...`);
        continue; // try next model
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
  if (!channel) return;
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

// 🛒 CREATE PRODUCT FLOW (Restored Printify Push)
async function createProduct(channel = null) {
  try {
    await sendSlackMessage("📊 Researching market...", channel);
    const niche = await performMarketResearch();

    await sendSlackMessage(`🎯 Niche: *${niche}*`, channel);

    const product = await generateProductData(niche);

    await sendSlackMessage(`📝 Writing SEO listing...`, channel);

    const imageId = await getLatestImage();
    if (!imageId) throw new Error("No image found.");

    await sendSlackMessage("🛒 Assembling product and pushing to Printify...", channel);

    // Get Printify Blueprint
    const catalog = await axios.get(
      "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
      { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
    );
    const variantId = catalog.data.variants?.[0]?.id;

    // Push to Printify
    const payload = {
      title: product.title,
      description: product.description,
      tags: product.tags,
      blueprint_id: 12,
      print_provider_id: 29,
      variants: [{ id: variantId, price: 2900, is_enabled: true }],
      print_areas: [{
        variant_ids: [variantId],
        placeholders: [{
          position: "front",
          images: [{
            id: imageId,
            x: 0.5,
            y: 0.5,
            scale: 0.2,
            angle: 0
          }]
        }]
      }]
    };

    await axios.post(
      `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
      payload,
      { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
    );

    await sendSlackMessage(`✅ *Product successfully published!*\n${product.title}`, channel);
    return product.title;

  } catch (err) {
    console.error(err);
    await sendSlackMessage(`❌ Error creating product: ${err.message}`, channel);
  }
}

// 🔁 AUTO POSTER (Restored for Automation)
setInterval(async () => {
  console.log("🤖 Running daily auto-batch posting...");
  try {
    for (let i = 0; i < 3; i++) {
      const title = await createProduct("#general");
    }
  } catch (err) {
    console.error("Batch Error:", err.message);
  }
}, 1000 * 60 * 60 * 24);

// 🔄 RESET TOKENS DAILY
setInterval(() => {
  dailyTokenUsage = 0;
  console.log("🔄 Tokens reset");
}, 1000 * 60 * 60 * 24);

// 🔥 SLACK EVENTS ENDPOINT
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  // Slack URL verification
  if (body.type === "url_verification") {
    return res.send(body.challenge);
  }

  // Acknowledge immediately
  res.status(200).send("OK");

  // Handle messages
  if (body.event && body.event.type === "message" && !body.event.bot_id) {
    const text = body.event.text;
    const channel = body.event.channel;

    console.log("📩 Slack message:", text);

    if (text.toLowerCase().includes("create product") || text.toLowerCase().includes("post now")) {
      await createProduct(channel);
    } else {
      const reply = await askGroq(text);
      await sendSlackMessage(reply, channel);
    }
  }
});

// 🧪 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("🚀 Ben is alive and fully automated");
});

// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`⚡ Server running on port ${PORT}`);
});
