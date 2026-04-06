import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// ENV
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

// 🧠 MEMORY
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

// 🔍 TREND KEYWORDS
const TREND_KEYWORDS = [
  "stoic quotes",
  "self discipline",
  "gym motivation",
  "quiet luxury",
  "minimal mindset",
  "success habits",
  "alpha mindset",
  "deep work",
  "focus mode",
  "no excuses"
];

// 🤖 OPENAI CALL
async function askOpenAI(prompt) {
  try {
    const estimatedTokens = prompt.length / 4;

    if (dailyTokenUsage + estimatedTokens > DAILY_TOKEN_LIMIT) {
      return null;
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          ...conversationHistory,
          { role: "user", content: prompt }
        ],
        max_tokens: 250,
        temperature: 0.6
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
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
    console.error("OpenAI Error:", err.response?.data || err.message);
    return null;
  }
}

// 🧠 EXTRACT JSON SAFELY
function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// 🎯 GENERATE PRODUCT
async function generateProductData() {
  const keyword = TREND_KEYWORDS[Math.floor(Math.random() * TREND_KEYWORDS.length)];

  const prompt = `
Return ONLY valid JSON:

{
  "title": "...",
  "description": "...",
  "tags": ["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10"]
}

Rules:
- SEO optimized title
- Clean description
- No AI/meta text

Keyword: ${keyword}
Style: ${designSpecs}
`;

  const raw = await askOpenAI(prompt);
  const parsed = extractJSON(raw);

  if (!parsed || !parsed.title) {
    throw new Error("Invalid AI output");
  }

  return parsed;
}

// 🖼 IMAGE
async function getLatestImage() {
  const res = await axios.get("https://api.printify.com/v1/uploads.json?limit=1", {
    headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
  });

  return res.data.data?.[0]?.id;
}

// 🛒 CREATE PRODUCT
async function createProduct() {
  const product = await generateProductData();
  const imageId = await getLatestImage();

  if (!imageId) throw new Error("No image found");

  const catalog = await axios.get(
    "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
    { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
  );

  const variantId = catalog.data.variants?.[0]?.id;

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

  return product.title;
}

// 📢 SLACK
async function sendSlackMessage(text, channel) {
  await axios.post("https://slack.com/api/chat.postMessage", {
    channel,
    text
  }, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  });
}

// 🔁 AUTO LOOP
setInterval(async () => {
  console.log("🤖 Auto posting...");

  try {
    const title = await createProduct();
    await sendSlackMessage(`🚀 New product created:\n${title}`, "#general");
  } catch (err) {
    console.error("Auto Error:", err.message);
  }

}, 1000 * 60 * 60 * 24);

// 🔄 RESET TOKENS
setInterval(() => {
  dailyTokenUsage = 0;
  console.log("🔄 Tokens reset");
}, 1000 * 60 * 60 * 24);

// 💬 SLACK
app.post("/slack/events", async (req, res) => {
  if (req.headers['x-slack-retry-num']) return res.status(200).send("OK");

  const { body } = req;

  if (body.type === "url_verification") {
    return res.send({ challenge: body.challenge });
  }

  res.status(200).send("OK");

  const event = body.event;

  if (event?.text && !event.bot_id) {
    const text = event.text.toLowerCase();

    try {
      if (text.includes("post now")) {
        const title = await createProduct();
        await sendSlackMessage(`🚀 Manual product created:\n${title}`, event.channel);
        return;
      }

      if (!text.includes("product") && !text.includes("etsy") && !text.includes("idea")) {
        return;
      }

      const reply = await askOpenAI(`
You are Ben, an AI business operator focused on Etsy growth.

Be concise.

User: ${event.text}
`);

      if (reply) {
        await sendSlackMessage(reply, event.channel);
      }

    } catch (err) {
      console.error("Slack Error:", err.message);
    }
  }
});

// HEALTH
app.get("/", (req, res) => {
  res.send("Ben OpenAI version running 🚀");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Ben OpenAI LIVE");
});
