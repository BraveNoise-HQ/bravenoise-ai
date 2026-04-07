import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// 🔐 ENV VARIABLES
const {
  GROQ_API_KEY,
  GEMINI_API_KEY,
  FAL_KEY,
  SLACK_BOT_TOKEN,
  PRINTIFY_API_TOKEN,
  PRINTIFY_SHOP_ID
} = process.env;

// 🧾 LOGGER
function log(level, message, meta = {}) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  }));
}

// ⚠️ ENV VALIDATION
if (!GROQ_API_KEY || !GEMINI_API_KEY || !PRINTIFY_API_TOKEN || !PRINTIFY_SHOP_ID || !FAL_KEY) {
  log("error", "Missing ENV variables");
}

// 🛒 PRODUCT MAP
const PRODUCT_MAP = {
  "t-shirt": { blueprint: 12, provider: 29 },
  "hoodie": { blueprint: 3, provider: 29 },
  "mug": { blueprint: 9, provider: 29 },
  "tote": { blueprint: 5, provider: 29 }
};

// ⏱️ DELAYS
const IMAGE_DELAY_MS = 10000;
const BATCH_DELAY_MS = 5000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 🔁 RETRY
async function retry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      log("warn", "Retrying...", { attempt: i + 1 });
      await sleep(2000);
    }
  }
}

// 📢 SLACK
async function sendSlack(text, channel = "#general") {
  if (!SLACK_BOT_TOKEN) return;

  try {
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      { channel, text },
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
    );
  } catch (err) {
    log("error", "Slack send failed", { error: err.message });
  }
}

// 🛡️ SAFE REQUEST
async function safeRequest(method, url, data = null, headers = {}, extraConfig = {}) {
  try {
    const res = await axios({
      method,
      url,
      data,
      headers,
      timeout: 20000,
      ...extraConfig
    });
    return res.data;
  } catch (err) {
    throw new Error(err.response?.status || "Network error");
  }
}

// 🧠 MEMORY
let usedNiches = new Set();

// 🤖 GROQ
async function askGroq(prompt) {
  try {
    const res = await safeRequest(
      "POST",
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }]
      },
      { Authorization: `Bearer ${GROQ_API_KEY}` }
    );
    return res.choices?.[0]?.message?.content || "";
  } catch {
    return null;
  }
}

// 🔍 TRENDING PRODUCT
async function getTrendingProduct() {
  const res = await askGroq(`
Give ONE trending Etsy print-on-demand product and niche.

Format:
product: (t-shirt, hoodie, mug, tote)
niche: ...
`);

  try {
    const lines = res.split("\n");
    return {
      product: lines[0].split(":")[1].trim().toLowerCase(),
      niche: lines[1].split(":")[1].trim()
    };
  } catch {
    return { product: "t-shirt", niche: "minimalist stoic quote" };
  }
}

// 🧾 SEO PRODUCT
async function getProduct(niche, productType) {
  try {
    const raw = await askGroq(`
Create a HIGH-CONVERTING Etsy listing.

Product: ${productType}
Niche: ${niche}

Return JSON with:
title, description, 13 tags
`);

    return JSON.parse(raw);
  } catch {
    return {
      title: `${niche} ${productType}`,
      description: `Premium ${productType} with ${niche} design.`,
      tags: Array(13).fill(niche)
    };
  }
}

// 🎨 PROMPT
async function getPrompt(niche) {
  return `
Huge bold typography t-shirt design.
Text fills entire canvas.
Centered chest layout.
No small text.
Theme: ${niche}
`;
}

// 🖼️ IMAGE (simplified)
async function generateImage(prompt) {
  return await retry(async () => {
    const res = await safeRequest(
      "POST",
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );
    return res.candidates[0].content.parts[0].inlineData.data;
  });
}

// 📤 UPLOAD
async function upload(image) {
  const res = await safeRequest(
    "POST",
    "https://api.printify.com/v1/uploads/images.json",
    { file_name: `design_${Date.now()}.png`, contents: image },
    { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
  );
  return res.id;
}

// 🛒 CREATE PRODUCT
async function createProduct(channel = "#general") {
  try {
    const { product, niche } = await getTrendingProduct();
    const config = PRODUCT_MAP[product];

    const productData = await getProduct(niche, product);
    const prompt = await getPrompt(niche);
    const image = await generateImage(prompt);
    const imageId = await upload(image);

    await safeRequest(
      "POST",
      `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
      {
        title: productData.title,
        description: productData.description,
        tags: productData.tags,
        blueprint_id: config.blueprint,
        print_provider_id: config.provider,
        variants: [{ id: 1, price: 2900, is_enabled: true }],
        print_areas: [{
          variant_ids: [1],
          placeholders: [{
            position: "front",
            images: [{
              id: imageId,
              x: 0.5,
              y: 0.5,
              scale: 0.85,
              angle: 0
            }]
          }]
        }]
      },
      { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
    );

    await sendSlack(`🔥 ${product} created | ${niche}`, channel);

  } catch (err) {
    await sendSlack(`❌ Error: ${err.message}`);
  }
}

// 📩 SLACK IMAGE → PRODUCT
async function handleImageProduct(event) {
  try {
    const file = event.files?.[0];
    if (!file) return;

    const res = await axios.get(file.url_private_download, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });

    const base64 = Buffer.from(res.data).toString("base64");

    const text = event.text.toLowerCase();
    const product =
      text.includes("mug") ? "mug" :
      text.includes("hoodie") ? "hoodie" :
      text.includes("tote") ? "tote" : "t-shirt";

    const config = PRODUCT_MAP[product];
    const imageId = await upload(base64);

    await safeRequest(
      "POST",
      `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
      {
        title: "Custom Upload",
        description: "User uploaded design",
        tags: ["custom"],
        blueprint_id: config.blueprint,
        print_provider_id: config.provider,
        variants: [{ id: 1, price: 2900, is_enabled: true }],
        print_areas: [{
          variant_ids: [1],
          placeholders: [{
            position: "front",
            images: [{
              id: imageId,
              x: 0.5,
              y: 0.5,
              scale: 0.85,
              angle: 0
            }]
          }]
        }]
      },
      { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
    );

    await sendSlack(`✅ Custom ${product} created`);
  } catch (err) {
    await sendSlack(`❌ Upload failed`);
  }
}

// 🔥 SLACK EVENTS
app.post("/slack/events", async (req, res) => {
  const b = req.body;
  res.sendStatus(200);

  if (b.event?.files) {
    await handleImageProduct(b.event);
    return;
  }

  const txt = b.event?.text?.toLowerCase();
  if (txt?.includes("create")) {
    await createProduct(b.event.channel);
  }
});

// 🌐 SERVER
app.listen(PORT, () => log("info", `Ben FINAL BOSS running 🚀`));
