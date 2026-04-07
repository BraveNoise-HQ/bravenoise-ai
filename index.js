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

// ⏱️ UTILS
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 🔁 RETRY
async function retry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      log("warn", "Retrying...", { attempt: i + 1, error: err.message });
      await sleep(2000);
    }
  }
}

// 📢 SLACK
async function sendSlack(text, channel = "#general") {
  if (!SLACK_BOT_TOKEN) return;

  try {
    const res = await axios.post(
      "https://slack.com/api/chat.postMessage",
      { channel, text },
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
    );

    if (!res.data.ok) {
      log("error", "Slack API error", { response: res.data });
    }

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
    log("error", "API Error", {
      url,
      status: err.response?.status,
      data: err.response?.data
    });
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
  } catch (err) {
    log("error", "Groq failed", { error: err.message });
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
    const result = {
      product: lines[0].split(":")[1].trim().toLowerCase(),
      niche: lines[1].split(":")[1].trim()
    };
    log("info", "Trending selected", result);
    return result;
  } catch {
    log("warn", "Fallback niche used");
    return { product: "t-shirt", niche: "minimalist stoic quote" };
  }
}

// 🧾 PRODUCT
async function getProduct(niche, productType) {
  try {
    const raw = await askGroq(`
Return ONLY JSON:
{"title":"...","description":"...","tags":["","","","","","","","","","","","",""]}
`);

    if (!raw) throw new Error("Empty");

    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean.substring(clean.indexOf('{'), clean.lastIndexOf('}') + 1));

    if (!parsed.tags || parsed.tags.length !== 13) throw new Error("Bad tags");

    return parsed;

  } catch (err) {
    log("warn", "Fallback product used", { error: err.message });
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
Bold typography design.
Large centered text filling 80-90% of canvas.
Use thick font (Montserrat ExtraBold / Bebas Neue / Anton style).
NO small text.
NO category labels.
Theme: ${niche}
`;
}

// 🖼️ IMAGE
async function generateImage(prompt) {
  return await retry(async () => {
    log("info", "Generating image");

    const res = await safeRequest(
      "POST",
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] }
    );

    const parts = res?.candidates?.[0]?.content?.parts || [];
    const img = parts.find(p => p.inlineData);

    if (!img?.inlineData?.data) throw new Error("No image");

    log("info", "Image generated");
    return img.inlineData.data;
  });
}

// 📤 UPLOAD
async function upload(image) {
  log("info", "Uploading image");

  const res = await safeRequest(
    "POST",
    "https://api.printify.com/v1/uploads/images.json",
    { file_name: `design_${Date.now()}.png`, contents: image },
    { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
  );

  log("info", "Upload success", { imageId: res.id });
  return res.id;
}

// 🛒 CREATE PRODUCT
async function createProduct(channel = "#general") {
  try {
    const { product, niche } = await getTrendingProduct();
    const config = PRODUCT_MAP[product] || PRODUCT_MAP["t-shirt"];

    log("info", "Creating product", { product, niche });

    const catalog = await safeRequest(
      "GET",
      `https://api.printify.com/v1/catalog/blueprints/${config.blueprint}/print_providers/${config.provider}/variants.json`,
      null,
      { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
    );

    const variant = catalog.variants?.[0];
    if (!variant) throw new Error("No variant found");

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
        variants: [{ id: variant.id, price: 2900, is_enabled: true }],
        print_areas: [{
          variant_ids: [variant.id],
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

    log("info", "Product created successfully");
    await sendSlack(`🔥 ${product} created | ${niche}`, channel);

  } catch (err) {
    log("error", "Create product failed", { error: err.message });
    await sendSlack(`❌ Error: ${err.message}`);
  }
}

// 📩 SLACK IMAGE → PRODUCT
async function handleImageProduct(event) {
  try {
    log("info", "Handling image upload");

    const file = event.files?.[0];
    if (!file) return;

    const res = await axios.get(file.url_private_download, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });

    const base64 = Buffer.from(res.data).toString("base64");

    const text = (event.text || "").toLowerCase();
    const product =
      text.includes("mug") ? "mug" :
      text.includes("hoodie") ? "hoodie" :
      text.includes("tote") ? "tote" : "t-shirt";

    const config = PRODUCT_MAP[product] || PRODUCT_MAP["t-shirt"];

    const catalog = await safeRequest(
      "GET",
      `https://api.printify.com/v1/catalog/blueprints/${config.blueprint}/print_providers/${config.provider}/variants.json`,
      null,
      { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
    );

    const variant = catalog.variants?.[0];
    if (!variant) throw new Error("No variant");

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
        variants: [{ id: variant.id, price: 2900, is_enabled: true }],
        print_areas: [{
          variant_ids: [variant.id],
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

    log("info", "Custom product created");
    await sendSlack(`✅ Custom ${product} created`);

  } catch (err) {
    log("error", "Upload flow failed", { error: err.message });
    await sendSlack(`❌ Upload failed`);
  }
}

// 🔥 SLACK EVENTS (FULL DEBUG)
app.post("/slack/events", async (req, res) => {
  const b = req.body;

  // ✅ FULL PAYLOAD LOG
  log("info", "Slack event FULL", {
    body: JSON.stringify(b)
  });

  // ✅ URL VERIFICATION
  if (b.type === "url_verification") {
    return res.send(b.challenge);
  }

  // ✅ RETRY PROTECTION
  if (req.headers['x-slack-retry-num']) {
    return res.sendStatus(200);
  }

  // ✅ IGNORE BOT MESSAGES
  if (b.event?.bot_id) return res.sendStatus(200);

  res.sendStatus(200);

  const txt = (b.event?.text || "").toLowerCase();

  log("info", "Parsed message", { txt });

  if (
    txt.includes("create") ||
    txt.includes("post") ||
    txt.includes("make") ||
    txt.includes("run") ||
    txt.includes("start")
  ) {
    log("info", "Trigger matched → creating product");
    await createProduct(b.event.channel);
  } else {
    log("info", "No trigger matched");
  }

  if (b.event?.files) {
    await handleImageProduct(b.event);
  }
});

// 🌐 SERVER
app.listen(PORT, () => log("info", `Ben FINAL BOSS running 🚀`));
