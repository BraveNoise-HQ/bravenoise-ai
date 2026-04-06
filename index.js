import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// ENV
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

const MODEL_NAME = "gemini-3-flash-preview";

// 🧠 MEMORY (limited)
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
} catch (err) {}

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

// 🤖 GEMINI CALL (WITH TOKEN LIMIT)
async function askGemini(prompt) {
  try {
    const estimatedTokens = prompt.length / 4;

    if (dailyTokenUsage + estimatedTokens > DAILY_TOKEN_LIMIT) {
      return "⚠️ Daily token limit reached. Try again tomorrow.";
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await axios.post(url, {
      contents: [
        ...conversationHistory,
        { role: "user", parts: [{ text: prompt }] }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300 // 🔥 reduced
      }
    });

    const reply =
      response.data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response.";

    // track tokens
    dailyTokenUsage += estimatedTokens;

    // memory update
    conversationHistory.push({ role: "user", parts: [{ text: prompt }] });
    conversationHistory.push({ role: "model", parts: [{ text: reply }] });

    // keep memory small
    conversationHistory = conversationHistory.slice(-4);

    return reply;

  } catch (err) {
    console.error("Gemini Error:", err.response?.data || err.message);
    return "⚠️ Gemini error.";
  }
}

// 🎯 GENERATE PRODUCT
async function generateProduct() {
  const keyword = TREND_KEYWORDS[Math.floor(Math.random() * TREND_KEYWORDS.length)];

  const prompt = `
You are an Etsy product expert.

Trending keyword: "${keyword}"

Create:
1. Product Title
2. Short Description
3. 10 Etsy Tags

Style: ${designSpecs}

Keep it minimal and highly sellable.
`;

  return await askGemini(prompt);
}

// 🖼 GET IMAGE
async function getLatestImage() {
  try {
    const res = await axios.get("https://api.printify.com/v1/uploads.json?limit=1", {
      headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
    });

    return res.data.data?.[0]?.id;

  } catch (err) {
    console.error("Image Error:", err.response?.data || err.message);
    return null;
  }
}

// 🛒 CREATE PRODUCT
async function createProduct() {
  try {
    const idea = await generateProduct();
    const imageId = await getLatestImage();

    if (!imageId) throw new Error("No image found");

    const catalog = await axios.get(
      "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
      { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
    );

    const variantId = catalog.data.variants?.[0]?.id;

    const payload = {
      title: `Drop ${Date.now()}`,
      description: idea,
      tags: ["minimalist", "streetwear", "trending"],
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

    return idea;

  } catch (err) {
    console.error("Create Product Error:", err.response?.data || err.message);
    throw err;
  }
}

// 📢 SLACK SEND
async function sendSlackMessage(text, channel) {
  try {
    await axios.post("https://slack.com/api/chat.postMessage", {
      channel,
      text
    }, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });
  } catch (err) {
    console.error("Slack Error:", err.response?.data || err.message);
  }
}

// 🔁 AUTO LOOP (24 HOURS)
setInterval(async () => {
  console.log("🤖 Ben auto loop running...");

  try {
    const idea = await createProduct();
    await sendSlackMessage(`🚀 Auto Product Posted:\n${idea}`, "#general");
  } catch (err) {
    console.error("Auto Loop Error:", err.message);
  }

}, 1000 * 60 * 60 * 24);

// 🔄 RESET TOKEN DAILY
setInterval(() => {
  console.log("🔄 Resetting daily token usage");
  dailyTokenUsage = 0;
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
      // 🔥 MANUAL POST
      if (text.includes("post now")) {
        const idea = await createProduct();

        await sendSlackMessage(
          `🚀 Manual Product Posted:\n${idea}`,
          event.channel
        );
        return;
      }

      // 💰 ONLY RESPOND TO BUSINESS-RELATED PROMPTS
      if (!text.includes("idea") && !text.includes("product") && !text.includes("etsy")) {
        return;
      }

      // 🧠 SMART CHAT
      const reply = await askGemini(`
You are Ben, Eric’s AI business partner.

Focus on:
- Etsy growth
- Product ideas
- Income generation

Be concise.

User: ${event.text}
`);

      await sendSlackMessage(reply, event.channel);

    } catch (err) {
      console.error("Slack Handler Error:", err.message);
    }
  }
});

// HEALTH
app.get("/", (req, res) => {
  res.send("Ben is alive 🚀");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Ben running (token-safe mode)");
});
