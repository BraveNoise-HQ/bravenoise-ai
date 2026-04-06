import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// 🔐 ENV VARIABLES
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FAL_KEY = process.env.FAL_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

// ⏱️ DELAYS
const IMAGE_DELAY_MS = 10000;
const BATCH_DELAY_MS = 5000;

// 💤 Sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
      console.error(`❌ ${url} → ${err.response.status}`, err.response.data);
      throw new Error(`HTTP ${err.response.status}`);
    } else {
      console.error(`❌ NETWORK ERROR → ${url}`, err.message);
      throw new Error("Network error");
    }
  }
}

// 🧠 MEMORY
let usedNiches = new Set();
let stats = { created: 0 };

// 🎨 DESIGN STYLE
let designSpecs = "Minimalist, bold typography, clean layout, flat vector, white background.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch {}

// 🧠 GROQ
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

// 🖼️ GEMINI (WITH RETRY)
async function gemini(prompt) {
  for (let i = 0; i < 2; i++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`;
      const res = await safeRequest("POST", url, {
        contents: [{ parts: [{ text: prompt }] }]
      });

      const part = res.candidates[0].content.parts.find(p => p.inlineData);
      if (!part) throw new Error("No image");

      return part.inlineData.data;
    } catch (err) {
      if (err.message.includes("429")) {
        console.log("⏳ Gemini rate limit, retrying...");
        await sleep(5000);
      } else {
        throw err;
      }
    }
  }
  throw new Error("Gemini failed");
}

// 🖼️ FAL (SAFE)
async function fal(prompt) {
  try {
    const res = await safeRequest(
      "POST",
      "https://fal.run/fal-ai/flux/schnell",
      { prompt, image_size: "square_hd" },
      { Authorization: `Key ${FAL_KEY}` }
    );

    const img = await safeRequest("GET", res.images[0].url, null, {}, { responseType: "arraybuffer" });
    return Buffer.from(img).toString("base64");

  } catch (err) {
    if (err.message.includes("403")) {
      console.log("💸 FAL balance empty, skipping...");
      throw new Error("FAL_DISABLED");
    }
    throw err;
  }
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
    console.log("🎨 Gemini...");
    return await gemini(prompt);
  } catch {
    try {
      console.log("⚠️ FAL fallback...");
      return await fal(prompt);
    } catch {
      console.log("🧾 Placeholder fallback...");
      return await placeholder(niche);
    }
  }
}

// 📤 PRINTIFY UPLOAD
async function upload(image, niche) {
  return (
    await safeRequest(
      "POST",
      "https://api.printify.com/v1/uploads/images.json",
      {
        file_name: `${niche}_${Date.now()}.png`,
        contents: image
      },
      { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
    )
  ).id;
}

// 🛒 PRODUCT CREATOR
async function createProduct() {
  try {
    const niche = await getNiche();
    console.log("🎯", niche);

    const product = await getProduct(niche);

    const headers = { Authorization: `Bearer ${PRINTIFY_TOKEN}` };

    const catalog = await safeRequest(
      "GET",
      "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
      null,
      headers
    );

    const variant = catalog.variants.find(v => v.is_enabled);

    if (!variant) throw new Error("No valid variant");

    for (let i = 1; i <= 3; i++) {
      console.log(`🎨 Design ${i}`);

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

          // 🔥 stays draft
          visible: false,

          variants: [
            {
              id: variant.id,
              price: 2900,
              is_enabled: true
            }
          ],

          print_areas: [
            {
              variant_ids: [variant.id],
              placeholders: [
                {
                  position: "front",
                  images: [
                    {
                      id: imageId,
                      x: 0.5,
                      y: 0.5,
                      scale: 0.7, // 🔥 FIXED (was too small before)
                      angle: 0
                    }
                  ]
                }
              ]
            }
          ]
        },
        headers
      );

      stats.created++;

      if (i < 3) await sleep(BATCH_DELAY_MS);
    }

    console.log("✅ Done batch");

  } catch (err) {
    console.error("❌ PRODUCT ERROR:", err.message);
  }
}

// 🔁 AUTO RUN
setInterval(createProduct, 1000 * 60 * 60 * 12);

// 🌐 SERVER
app.get("/", (_, res) => res.send("Ben v5 running 🚀"));

app.listen(PORT, () => console.log(`⚡ ${PORT}`));
