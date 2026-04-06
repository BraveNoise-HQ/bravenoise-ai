import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// ENV (MATCHES YOUR VARIABLE NAME)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
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

// 🔥 NICHE STRATEGY
const NICHE_COMBINATIONS = [
  "stoic discipline gym mindset",
  "minimalist success quotes",
  "quiet luxury aesthetic text",
  "alpha male focus motivation",
  "deep work productivity mindset",
  "self mastery stoicism",
  "no excuses fitness mindset",
  "clean typography motivation",
  "modern minimal confidence quote",
  "success driven lifestyle"
];

// 🤖 OPENAI CALL
async function askOpenAI(prompt) {
  try {
    const estimatedTokens = prompt.length / 4;

    if (dailyTokenUsage + estimatedTokens > DAILY_TOKEN_LIMIT) {
      console.log("⚠️ Token limit reached");
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

// 🎯 GENERATE PRODUCT
async function generateProductData() {
  const niche = NICHE_COMBINATIONS[Math.floor(Math.random() * NICHE_COMBINATIONS.length)];

  const prompt = `
You are a top 1% Etsy SEO expert.

Return ONLY JSON:

{
  "title": "...",
  "description": "...",
  "tags": ["","","","","","","","","",""]
}

RULES:

TITLE:
- 120-140 characters
- SEO optimized

DESCRIPTION:
- Strong first line hook
- Clean formatting
- No AI/meta text

TAGS:
- 10 real Etsy search phrases

NICHE: ${niche}
STYLE: ${designSpecs}
`;

  const raw = await askOpenAI(prompt);
  const parsed = extractJSON(raw);

  if (!parsed || !parsed.title) {
    throw new Error("Invalid AI output");
  }

  return parsed;
}

// 🖼 GET IMAGE
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

// 📢 SLACK MESSAGE
async function sendSlackMessage(text, channel) {
  await axios.post("https://slack.com/api/chat.postMessage", {
    channel,
    text
  }, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  });
}

// 🔁 AUTO POST (3 PRODUCTS DAILY)
setInterval(async () => {
  console.log("🤖 Level 3 batch posting...");

  try {
    for (let i = 0; i < 3; i++) {
      const title = await createProduct();

      await sendSlackMessage(
        `🚀 Product ${i + 1} created:\n${title}`,
        "#general"
      );
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

// 💬 SLACK EVENTS
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
        await sendSlackMessage(`🚀 Product created:\n${title}`, event.channel);
        return;
      }

      if (text.includes("post 3")) {
        for (let i = 0; i < 3; i++) {
          const title = await createProduct();
          await sendSlackMessage(`🚀 ${title}`, event.channel);
        }
        return;
      }

      if (!text.includes("product") && !text.includes("etsy") && !text.includes("idea")) {
        return;
      }

      const reply = await askOpenAI(`
You are Ben, an AI business operator focused on Etsy growth.

Be concise and actionable.

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
  res.send("🚀 Ben Level 3 running (money mode)");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Ben Level 3 LIVE");
});
