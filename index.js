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

// 🧾 LOGGER (Full Visibility)
function log(level, message, meta = {}) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  }));
}

// ⚠️ ENV VALIDATION
if (!GROQ_API_KEY || !GEMINI_API_KEY || !PRINTIFY_API_TOKEN || !PRINTIFY_SHOP_ID) {
  log("error", "Missing ENV variables");
}

// 🛒 PRODUCT MAP
const PRODUCT_MAP = {
  "t-shirt": { blueprint: 12, provider: 29, color: "Black", size: "M" },
  "hoodie": { blueprint: 77, provider: 29, color: "Black", size: "L" }, // Updated to standard hoodie
  "mug": { blueprint: 9, provider: 29, color: "White", size: "11oz" },
  "tote": { blueprint: 5, provider: 29, color: "Natural", size: "OS" }
};

// ⏱️ UTILS
const IMAGE_DELAY_MS = 10000;
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
    if (!res.data.ok) log("error", "Slack API error", { response: res.data });
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
    log("error", "API Error", { url, status: err.response?.status, data: err.response?.data });
    throw new Error(err.response?.status || "Network error");
  }
}

// 🧠 STATE, MEMORY & PERSONALITY
let chatHistory = [];
const BEN_PERSONA = `You are Ben, a warm, approachable, and enthusiastic AI business operator. Your goal is to manage and automate an Etsy Print-on-Demand business. 
You know your human partner is a talented professional photographer, graphic designer, and video editor. Your job is to handle the heavy lifting—market research, SEO, bulk AI design generation, and Printify uploads. 
Be supportive, knowledgeable, and friendly, but keep your responses concise and actionable.`;

// 🤖 GROQ (With Chat History Support)
async function askGroq(prompt, isChat = false) {
  try {
    const messages = [];
    
    if (isChat) {
      messages.push({ role: "system", content: BEN_PERSONA });
      messages.push(...chatHistory);
    } else {
      messages.push({ role: "system", content: "You are an expert backend processor. Output strictly what is requested." });
    }
    
    messages.push({ role: "user", content: prompt });

    const res = await safeRequest(
      "POST",
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: messages
      },
      { Authorization: `Bearer ${GROQ_API_KEY}` }
    );

    const reply = res.choices?.[0]?.message?.content || "";

    if (isChat) {
      chatHistory.push({ role: "user", content: prompt });
      chatHistory.push({ role: "assistant", content: reply });
      if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8); 
    }

    return reply;
  } catch (err) {
    log("error", "Groq failed", { error: err.message });
    return null;
  }
}

// 🔍 TRENDING PRODUCT
async function getTrendingProduct() {
  const res = await askGroq(`Give ONE trending Etsy print-on-demand product and niche. Format exactly like this:
product: hoodie
niche: stoic quote`);

  try {
    const lines = res.split("\n").filter(l => l.includes(":"));
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

// 🧾 PRODUCT SEO
async function getProduct(niche, productType) {
  try {
    const raw = await askGroq(`Return ONLY JSON:
{"title":"...","description":"...","tags":["","","","","","","","","","","","",""]}`);

    if (!raw) throw new Error("Empty response");

    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean.substring(clean.indexOf('{'), clean.lastIndexOf('}') + 1));

    if (!parsed.tags || parsed.tags.length !== 13) throw new Error("Bad tags array");

    return parsed;
  } catch (err) {
    log("warn", "Fallback product SEO used", { error: err.message });
    return {
      title: `${niche} ${productType}`,
      description: `Premium ${productType} featuring a custom ${niche} design.`,
      tags: Array(13).fill(niche)
    };
  }
}

// 🎨 PROMPT
async function getPrompt(niche) {
  return `Bold typography design. Large centered text filling 80-90% of canvas. Use thick font (Montserrat ExtraBold / Bebas Neue / Anton style). NO small text. NO category labels. Theme: ${niche}`;
}

// 🖼️ PLACEHOLDER (The 429 Quota Shield)
async function placeholder() {
  log("info", "Using placeholder fallback image");
  const url = `https://placehold.co/1024x1024/transparent/white.png?text=DESIGN+DRAFT&font=Montserrat`;
  const img = await safeRequest("GET", url, null, {}, { responseType: "arraybuffer" });
  return Buffer.from(img).toString("base64");
}

// 🖼️ IMAGE (Protected by try/catch)
async function generateImage(prompt) {
  try {
    return await retry(async () => {
      log("info", "Generating image with Gemini");
      const res = await safeRequest(
        "POST",
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: prompt }] }] }
      );

      const parts = res?.candidates?.[0]?.content?.parts || [];
      const img = parts.find(p => p.inlineData);

      if (!img?.inlineData?.data) throw new Error("No image data returned");

      log("info", "Image generated successfully");
      return img.inlineData.data;
    });
  } catch (err) {
    log("warn", "Gemini failed or hit quota limit, using fallback", { error: err.message });
    return await placeholder();
  }
}

// 📤 UPLOAD
async function upload(image) {
  log("info", "Uploading image to Printify");
  const res = await safeRequest(
    "POST",
    "https://api.printify.com/v1/uploads/images.json",
    { file_name: `design_${Date.now()}.png`, contents: image },
    { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
  );
  log("info", "Upload success", { imageId: res.id });
  return res.id;
}

// 🛠️ GET VARIANT HELPER (Prevents Printify 400 Errors)
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

// 🛒 CREATE PRODUCT
async function createProduct(channel = "#general") {
  try {
    const { product, niche } = await getTrendingProduct();
    const config = PRODUCT_MAP[product] || PRODUCT_MAP["t-shirt"];

    log("info", "Creating product flow started", { product, niche });
    await sendSlack(`⏳ Researching trending ${product} for "${niche}"...`, channel);

    // Get Variant, SEO, Prompt, Image, and Upload
    const variantId = await getVariantId(config.blueprint, config.provider, config.color, config.size);
    const productData = await getProduct(niche, product);
    const prompt = await getPrompt(niche);
    const image = await generateImage(prompt);
    
    await sleep(IMAGE_DELAY_MS);
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
        visible: false,
        variants: [{ id: variantId, price: 2900, is_enabled: true }], // Dynamic Variant ID
        print_areas: [{
          variant_ids: [variantId], // Dynamic Variant ID
          placeholders: [{
            position: "front",
            images: [{ id: imageId, x: 0.5, y: 0.5, scale: 0.85, angle: 0 }]
          }]
        }]
      },
      { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
    );

    log("info", "Product created successfully");
    await sendSlack(`🔥 Auto-Generated ${product} created for: ${niche}`, channel);

  } catch (err) {
    log("error", "Create product failed", { error: err.message });
    await sendSlack(`❌ Error: ${err.message}`, channel);
  }
}

// 📩 SLACK IMAGE → PRODUCT
async function handleImageProduct(event) {
  try {
    const channel = event.channel;
    log("info", "Handling custom image upload");
    await sendSlack("📥 Image received! Generating SEO listing...", channel);

    const file = event.files?.[0];
    if (!file) return;

    const res = await axios.get(file.url_private_download, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });

    const base64 = Buffer.from(res.data).toString("base64");

    const text = (event.text || "").toLowerCase();
    const product = text.includes("mug") ? "mug" : text.includes("hoodie") ? "hoodie" : text.includes("tote") ? "tote" : "t-shirt";
    const config = PRODUCT_MAP[product] || PRODUCT_MAP["t-shirt"];

    const variantId = await getVariantId(config.blueprint, config.provider, config.color, config.size);
    const productData = await getProduct(text || "custom design", product);
    const imageId = await upload(base64);

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
        variants: [{ id: variantId, price: 2900, is_enabled: true }],
        print_areas: [{
          variant_ids: [variantId],
          placeholders: [{
            position: "front",
            images: [{ id: imageId, x: 0.5, y: 0.5, scale: 0.85, angle: 0 }]
          }]
        }]
      },
      { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
    );

    log("info", "Custom product created");
    await sendSlack(`✅ Custom ${product} uploaded and optimized for: "${text || 'custom design'}"`, channel);

  } catch (err) {
    log("error", "Upload flow failed", { error: err.message });
    await sendSlack(`❌ Upload failed: ${err.message}`, event.channel);
  }
}

// 🔥 SLACK EVENTS (The Communicator)
app.post("/slack/events", async (req, res) => {
  const b = req.body;

  // ✅ URL VERIFICATION & RETRY PROTECTION
  if (b.type === "url_verification") return res.send(b.challenge);
  if (req.headers['x-slack-retry-num']) return res.sendStatus(200);
  res.sendStatus(200);

  // ✅ IGNORE BOT MESSAGES
  if (b.event?.bot_id) return;

  const originalText = b.event?.text || "";
  const txt = originalText.toLowerCase();
  const channel = b.event?.channel;

  log("info", "Slack message received", { text: originalText, hasFiles: !!b.event?.files });

  // 1. Check for file uploads first
  if (b.event?.files) {
    await handleImageProduct(b.event);
    return;
  }

  // 2. Check for trigger words
  if (
    txt.includes("create") ||
    txt.includes("post") ||
    txt.includes("make") ||
    txt.includes("run") ||
    txt.includes("start")
  ) {
    log("info", "Trigger matched → starting product workflow");
    await createProduct(channel);
  } 
  // 3. Fallback to Ben's conversational personality
  else if (txt) {
    log("info", "No trigger matched → routing to Groq chat");
    const reply = await askGroq(originalText, true); // true = Use Persona & Chat History
    if (reply) {
      await sendSlack(reply, channel);
    } else {
      log("warn", "Groq failed to generate a chat reply");
    }
  }
});

// 🌐 SERVER & CRASH HANDLERS
process.on("unhandledRejection", async (err) => {
  log("error", "Unhandled rejection", { error: err.message });
});
process.on("uncaughtException", async (err) => {
  log("error", "Uncaught exception", { error: err.message });
});

app.get("/", (_, res) => res.send("Ben v6.0 running 🚀"));
app.listen(PORT, () => log("info", `Ben v6.0 running on ${PORT} 🚀`));
