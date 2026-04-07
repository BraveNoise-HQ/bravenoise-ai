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

// 🛒 PRODUCT MAP (With default target colors/sizes)
const PRODUCT_MAP = {
  "t-shirt": { blueprint: 12, provider: 29, color: "Black", size: "M" },
  "hoodie": { blueprint: 77, provider: 29, color: "Black", size: "L" },
  "mug": { blueprint: 9, provider: 29, color: "White", size: "11oz" },
  "tote": { blueprint: 5, provider: 29, color: "Natural", size: "OS" }
};

// ⏱️ DELAYS
const IMAGE_DELAY_MS = 10000;
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
Format exactly like this (no extra text):
product: hoodie
niche: stoic quote
`);

  try {
    const lines = res.split("\n").filter(l => l.includes(":"));
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
Return ONLY valid JSON with no markdown:
{"title": "...", "description": "...", "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11", "tag12", "tag13"]}
`);
    const cleanText = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
  } catch {
    return {
      title: `${niche} ${productType}`,
      description: `Premium ${productType} with a custom ${niche} design.`,
      tags: [niche, productType, "custom design", "apparel", "gift", "trending", "graphic", "minimalist", "style", "fashion", "unique", "art", "cool"]
    };
  }
}

// 🎨 PROMPT
async function getPrompt(niche) {
  return `Huge bold typography t-shirt design. Text fills entire canvas. Centered chest layout. No small text. Theme: ${niche}. Pure white background.`;
}

// 🖼️ IMAGE (Gemini Only)
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

// 🛠️ GET VARIANT HELPER (Restored so Printify doesn't crash)
async function getVariantId(blueprint, provider, targetColor, targetSize) {
  const headers = { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` };
  const catalog = await safeRequest(
    "GET",
    `https://api.printify.com/v1/catalog/blueprints/${blueprint}/print_providers/${provider}/variants.json`,
    null,
    headers
  );
  const variants = catalog.variants || [];
  const variant = variants.find(v => v.title && v.title.includes(targetColor) && v.title.includes(targetSize)) || variants[0];
  if (!variant) throw new Error("No variants found in catalog.");
  return variant.id;
}

// 🛒 CREATE PRODUCT (Auto-Generated)
async function createProduct(channel = "#general") {
  try {
    const { product, niche } = await getTrendingProduct();
    const config = PRODUCT_MAP[product] || PRODUCT_MAP["t-shirt"];

    await sendSlack(`⏳ Researching ${product} in the "${niche}" niche...`, channel);

    const productData = await getProduct(niche, product);
    const prompt = await getPrompt(niche);
    const image = await generateImage(prompt);
    
    await sleep(IMAGE_DELAY_MS);
    const imageId = await upload(image);
    
    // Grab the real variant ID!
    const variantId = await getVariantId(config.blueprint, config.provider, config.color, config.size);

    await safeRequest(
      "POST",
      `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
      {
        title: productData.title,
        description: productData.description,
        tags: productData.tags,
        blueprint_id: config.blueprint,
        print_provider_id: config.provider,
        visible: false,
        variants: [{ id: variantId, price: 2900, is_enabled: true }], // Fixed!
        print_areas: [{
          variant_ids: [variantId], // Fixed!
          placeholders: [{
            position: "front",
            images: [{ id: imageId, x: 0.5, y: 0.5, scale: 0.85, angle: 0 }]
          }]
        }]
      },
      { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
    );

    await sendSlack(`🔥 Auto-Generated ${product} created for: ${niche}`, channel);

  } catch (err) {
    await sendSlack(`❌ Error: ${err.message}`, channel);
  }
}

// 📩 SLACK IMAGE → PRODUCT (Fully SEO Optimized)
async function handleImageProduct(event) {
  const channel = event.channel;
  try {
    const file = event.files?.[0];
    if (!file) return;

    await sendSlack("📥 Image received. Downloading and analyzing...", channel);

    const res = await axios.get(file.url_private_download, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });

    const base64 = Buffer.from(res.data).toString("base64");

    // Extract product type and niche from the text you typed with the image
    const text = event.text ? event.text.toLowerCase() : "custom design";
    const product =
      text.includes("mug") ? "mug" :
      text.includes("hoodie") ? "hoodie" :
      text.includes("tote") ? "tote" : "t-shirt";

    const config = PRODUCT_MAP[product];
    
    // Ask AI to generate the SEO based on what you typed!
    const productData = await getProduct(text, product);
    const imageId = await upload(base64);
    
    // Grab the real variant ID!
    const variantId = await getVariantId(config.blueprint, config.provider, config.color, config.size);

    await safeRequest(
      "POST",
      `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
      {
        title: productData.title, // Fully SEO Optimized Title!
        description: productData.description,
        tags: productData.tags,
        blueprint_id: config.blueprint,
        print_provider_id: config.provider,
        visible: false,
        variants: [{ id: variantId, price: 2900, is_enabled: true }], // Fixed!
        print_areas: [{
          variant_ids: [variantId], // Fixed!
          placeholders: [{
            position: "front",
            images: [{ id: imageId, x: 0.5, y: 0.5, scale: 0.85, angle: 0 }]
          }]
        }]
      },
      { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
    );

    await sendSlack(`✅ Custom ${product} uploaded and SEO optimized for: "${text}"`, channel);
  } catch (err) {
    await sendSlack(`❌ Upload failed: ${err.message}`, channel);
  }
}

// 🔥 SLACK EVENTS
app.post("/slack/events", async (req, res) => {
  const b = req.body;
  
  if (b.type === "url_verification") return res.send(b.challenge);
  
  // Acknowledge Slack immediately so it doesn't retry
  res.sendStatus(200);

  if (b.event?.bot_id) return;

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
