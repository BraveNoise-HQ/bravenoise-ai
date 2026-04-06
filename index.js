import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";
import cron from "node-cron";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// API KEYS
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

const MODEL_NAME = "gemini-3-flash-preview";

// 🧠 MEMORY
let conversationHistory = [];

// 🎨 DESIGN RULES
let designSpecs = "Minimalist, bold typography, clean layout.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch (err) {}

// 🔍 FAKE TREND DATA (upgrade later with scraping)
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

// 🤖 GEMINI CALL
async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await axios.post(url, {
    contents: [
      ...conversationHistory,
      { role: "user", parts: [{ text: prompt }] }
    ],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 800
    }
  });

  const reply = response.data.candidates[0].content.parts[0].text;

  conversationHistory.push({ role: "user", parts: [{ text: prompt }] });
  conversationHistory.push({ role: "model", parts: [{ text: reply }] });

  // keep memory short
  conversationHistory = conversationHistory.slice(-10);

  return reply;
}

// 🎯 GENERATE PRODUCT IDEA
async function generateProduct() {
  const keyword = TREND_KEYWORDS[Math.floor(Math.random() * TREND_KEYWORDS.length)];

  const prompt = `
  You are an Etsy product expert.

  Based on this trending keyword: "${keyword}"

  Create:
  1. Product Title (SEO optimized)
  2. Description (short but compelling)
  3. 10 Etsy tags

  Style: ${designSpecs}

  Keep it clean, minimal, and marketable.
  `;

  return await askGemini(prompt);
}

// 🖼 GET LATEST IMAGE
async function getLatestImage() {
  const res = await axios.get("https://api.printify.com/v1/uploads.json?limit=1", {
    headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
  });

  return res.data.data[0].id;
}

// 🛒 CREATE PRODUCT
async function createProduct() {
  const idea = await generateProduct();
  const imageId = await getLatestImage();

  const catalog = await axios.get(
    "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
    { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
  );

  const variantId = catalog.data.variants[0].id;

  const payload = {
    title: `Drop ${Date.now()}`,
    description: idea,
    tags: ["minimalist", "trending", "streetwear"],
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
}

// 📢 SEND TO SLACK
async function sendSlackMessage(text, channel) {
  await axios.post("https://slack.com/api/chat.postMessage", {
    channel,
    text
  }, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  });
}

// ⏱ DAILY AUTONOMOUS DROP
cron.schedule("0 10 * * *", async () => {
  console.log("🤖 Ben running daily task...");

  try {
    const idea = await createProduct();

    await sendSlackMessage(
      `🚀 Daily Product Live:\n${idea}`,
      "#general"
    );

  } catch (err) {
    console.error("AUTO ERROR:", err.message);
  }
});

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
      // 🔥 MANUAL TRIGGER
      if (text.includes("post now")) {
        const idea = await createProduct();

        await sendSlackMessage(
          `🚀 Manual Drop Done:\n${idea}`,
          event.channel
        );
        return;
      }

      // 🧠 NORMAL CHAT
      const persona = `
      You are Ben, Eric’s AI operator.

      You help him:
      - Grow Etsy income
      - Create products
      - Think like a business partner

      Tone: smart, grounded, slightly witty.
      `;

      const reply = await askGemini(persona + "\nUser: " + event.text);

      await sendSlackMessage(reply, event.channel);

    } catch (err) {
      console.error(err.message);
    }
  }
});

// HEALTH CHECK
app.get("/", (req, res) => {
  res.send("Ben Level 2 is running 🚀");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Ben Level 2 LIVE");
});
