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

// 🧾 LOGGER (STRUCTURED)
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

// ⏱️ DELAYS
const IMAGE_DELAY_MS = 10000;
const BATCH_DELAY_MS = 5000;

// 💤 Sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
    if (err.response) {
      log("error", "API Error", {
        url,
        status: err.response.status,
        data: err.response.data
      });

      if (err.response.status >= 500) {
        await sendSlack(`🚨 API DOWN\n${url}\nStatus: ${err.response.status}`);
      }

      throw new Error(`HTTP ${err.response.status}`);
    } else {
      log("error", "Network Error", { url, error: err.message });
      throw new Error("Network error");
    }
  }
}

// 🧠 STATE
let usedNiches = new Set();
let stats = { created: 0 };

// 🎨 DESIGN STYLE
let designSpecs = "Minimalist, bold typography, clean layout, flat vector, white background.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch {}

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

// 🎯 NICHE
async function getNiche() {
  for (let i = 0; i < 5; i++) {
    const n = (await askGroq("Give ONE profitable t-shirt niche."))?.trim();
    if (n && !usedNiches.has(n)) {
      usedNiches.add(n);
      return n;
    }
  }
  return "minimalist stoic quote";
}

// 🧾 PRODUCT DATA
async function getProduct(niche) {
  const raw = await askGroq(`Create Etsy listing JSON for "${niche}"`);
  try {
    return JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
  } catch {
    throw new Error("Bad product JSON");
  }
}

// 🎨 PROMPT
async function getPrompt(niche, v) {
  return await askGroq(`T-shirt design for ${niche}, variation ${v}, ${designSpecs}`);
}

// 🖼️ GEMINI
async function gemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`;

  const res = await safeRequest("POST", url, {
    contents: [{ parts: [{ text: prompt }] }]
  });

  const parts = res?.candidates?.[0]?.content?.parts || [];
  const part = parts.find(p => p.inlineData);

  if (!part?.inlineData?.data) {
    throw new Error("No image from Gemini");
  }

  return part.inlineData.data;
}

// 🖼️ FAL
async function fal(prompt) {
  const res = await safeRequest(
    "POST",
    "https://fal.run/fal-ai/flux/schnell",
    { prompt, image_size: "square_hd" },
    { Authorization: `Key ${FAL_KEY}` }
  );

  if (!res?.images?.length) {
    throw new Error("FAL returned no images");
  }

  const img = await safeRequest(
    "GET",
    res.images[0].url,
    null,
    {},
    { responseType: "arraybuffer" }
  );

  return Buffer.from(img).toString("base64");
}

// 🖼️ PLACEHOLDER
async function placeholder(niche) {
  const text = encodeURIComponent(niche.toUpperCase());
  const url = `https://dummyimage.com/1024x1024/ffffff/000000.png&text=${text}`;
  const img = await safeRequest("GET", url, null, {}, { responseType: "arraybuffer" });
  return Buffer.from(img).toString("base64");
}

// 🧠 IMAGE ROUTER
async function generateImage(prompt, niche) {
  try {
    log("info", "Gemini start");
    return await gemini(prompt);
  } catch {
    try {
      log("warn", "FAL fallback");
      return await fal(prompt);
    } catch {
      log("warn", "Placeholder fallback");
      return await placeholder(niche);
    }
  }
}

// 📤 UPLOAD
async function upload(image, niche) {
  const res = await safeRequest(
    "POST",
    "https://api.printify.com/v1/uploads/images.json",
    {
      file_name: `${niche}_${Date.now()}.png`,
      contents: image
    },
    { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` }
  );

  return res.id;
}

// 🛒 PRODUCT CREATOR
async function createProduct(channel = "#general") {
  try {
    await sendSlack("🚀 Starting product workflow...", channel);

    const niche = await getNiche();
    log("info", "Niche selected", { niche });

    const product = await getProduct(niche);

    const headers = { Authorization: `Bearer ${PRINTIFY_API_TOKEN}` };

    const catalog = await safeRequest(
      "GET",
      "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
      null,
      headers
    );

    const variant = catalog.variants.find(v => v.is_enabled);
    if (!variant) throw new Error("No variant");

    for (let i = 1; i <= 3; i++) {
      log("info", "Creating design", { i });

      const prompt = await getPrompt(niche, i);
      const image = await generateImage(prompt, niche);

      await sleep(IMAGE_DELAY_MS);

      const imageId = await upload(image, niche);

      await safeRequest(
        "POST",
        `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
        {
          title: `${product.title} V${i}`,
          description: product.description,
          tags: product.tags,
          blueprint_id: 12,
          print_provider_id: 29,
          visible: false,
          variants: [{ id: variant.id, price: 2900, is_enabled: true }],
          print_areas: [{
            variant_ids: [variant.id],
            placeholders: [{
              position: "front",
              images: [{
                id: imageId,
                x: 0.5,
                y: 0.5,
                scale: 0.7,
                angle: 0
              }]
            }]
          }]
        },
        headers
      );

      stats.created++;

      if (i < 3) await sleep(BATCH_DELAY_MS);
    }

    await sendSlack(`✅ Batch complete\nNiche: ${niche}\nTotal: 3 designs`, channel);

  } catch (err) {
    log("error", "Product failed", { error: err.message });
    await sendSlack(`❌ PRODUCT ERROR\n${err.message}`, channel);
  }
}

// 🔁 AUTO RUN
setInterval(() => {
  log("info", "Scheduled run triggered");
  createProduct();
}, 1000 * 60 * 60 * 12);

// 📊 DAILY REPORT
setInterval(() => {
  sendSlack(`📊 Daily Report\nCreated: ${stats.created}`);
  stats = { created: 0 };
}, 1000 * 60 * 60 * 24);

// 🔥 GLOBAL ERROR HANDLERS
process.on("unhandledRejection", async (err) => {
  log("error", "Unhandled rejection", { error: err.message });
  await sendSlack(`💥 UNHANDLED ERROR\n${err.message}`);
});

process.on("uncaughtException", async (err) => {
  log("error", "Uncaught exception", { error: err.message });
  await sendSlack(`💥 CRASH\n${err.message}`);
});

// 🌐 SERVER
app.get("/", (_, res) => res.send("Ben v4.5 running 🚀"));

app.listen(PORT, () => log("info", `Server running on ${PORT}`));
