import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// 🔐 ENV
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FAL_KEY = process.env.FAL_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

// ⏳ UTILS
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let conversationHistory = [];
let dailyTokenUsage = 0;
const DAILY_TOKEN_LIMIT = 20000;

// 🎨 DESIGN STYLE
let designSpecs = "Minimalist, bold typography, clean layout, flat vector style, pure white background.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch {}

// 🤖 GROQ
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

async function askGroq(prompt, maxTokens = 500) {
  for (const model of GROQ_MODELS) {
    try {
      const estimated = prompt.length / 4;

      if (dailyTokenUsage + estimated > DAILY_TOKEN_LIMIT) {
        return "⚠️ Daily AI limit reached.";
      }

      const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [...conversationHistory, { role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.7
        },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
      );

      const reply = res.data.choices?.[0]?.message?.content || "";
      dailyTokenUsage += estimated;

      conversationHistory.push({ role: "user", content: prompt });
      conversationHistory.push({ role: "assistant", content: reply });
      conversationHistory = conversationHistory.slice(-4);

      return reply;

    } catch (err) {
      if (err.response?.data?.code === "model_permission_blocked_project") continue;
      console.log("Groq error:", err.message);
      return null;
    }
  }
  return null;
}

// 🧠 JSON PARSER
function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

// 📊 MARKET
async function performMarketResearch() {
  const result = await askGroq(`
Find ONE profitable, low competition t-shirt niche.
Return ONLY short phrase.
`, 100);

  return result?.trim() || "minimalist stoic quotes";
}

// 📝 PRODUCT DATA
async function generateProductData(niche) {
  const raw = await askGroq(`
Create Etsy listing JSON for niche "${niche}"
{
 "title": "...",
 "description": "...",
 "tags": ["","","","","","","","","",""]
}
`, 800);

  const parsed = extractJSON(raw);
  if (!parsed) throw new Error("Bad JSON");
  return parsed;
}

// 🎨 PROMPT
async function generateDesignPrompt(niche) {
  const result = await askGroq(`
Create t-shirt design prompt for "${niche}"
Style: ${designSpecs}
2 sentences max. No background.
`, 200);

  return result || `Minimalist typography design about ${niche}`;
}

// 🖼️ GEMINI
async function callGeminiImage(prompt) {
  await sleep(2000); // prevent 429

  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }]
    }
  );

  const parts = res.data.candidates[0].content.parts;
  const img = parts.find(p => p.inlineData);

  if (!img) throw new Error("No image");
  return img.inlineData.data;
}

// 🖼️ FAL
async function callFalImage(prompt) {
  const res = await axios.post(
    "https://fal.run/fal-ai/flux/schnell",
    { prompt, image_size: "square_hd" },
    { headers: { Authorization: `Key ${FAL_KEY}` } }
  );

  const url = res.data.images[0].url;
  const img = await axios.get(url, { responseType: "arraybuffer" });

  return Buffer.from(img.data).toString("base64");
}

// 🧯 FINAL FALLBACK
function fallbackImage(niche) {
  const svg = `
  <svg width="2000" height="2000">
    <rect width="100%" height="100%" fill="white"/>
    <text x="50%" y="50%" font-size="120" text-anchor="middle" fill="black">
      ${niche}
    </text>
  </svg>`;
  return Buffer.from(svg).toString("base64");
}

// 🎨 MASTER
async function generateImage(prompt, niche) {
  try {
    console.log("🎨 Gemini...");
    return await callGeminiImage(prompt);
  } catch (e) {
    console.log("⚠️ Gemini failed");

    try {
      console.log("🎨 FAL...");
      return await callFalImage(prompt);
    } catch (f) {
      if (f.response?.data?.detail?.includes("Exhausted balance")) {
        console.log("💸 FAL no credits");
      }
      console.log("🧯 Using fallback design");
      return fallbackImage(niche);
    }
  }
}

// 📤 PRINTIFY UPLOAD
async function uploadToPrintify(imageData, niche) {
  const name = niche.replace(/\W+/g, "_") + ".png";

  const res = await axios.post(
    "https://api.printify.com/v1/uploads/images.json",
    { file_name: name, contents: imageData },
    { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
  );

  return res.data.id;
}

// 📢 SLACK
async function sendSlackMessage(text, channel) {
  if (!channel) return;
  await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, text },
    { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
  );
}

// 🛒 MAIN FLOW
async function createProduct(channel = null) {
  try {
    const niche = await performMarketResearch();
    await sendSlackMessage(`🎯 ${niche}`, channel);

    const product = await generateProductData(niche);
    const prompt = await generateDesignPrompt(niche);
    const image = await generateImage(prompt, niche);
    const imageId = await uploadToPrintify(image, niche);

    const catalog = await axios.get(
      "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
      { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
    );

    const variant =
      catalog.data.variants.find(v =>
        v.title.includes("Black") && v.title.includes("M")
      ) || catalog.data.variants[0];

    const payload = {
      title: product.title,
      description: product.description,
      tags: product.tags,
      blueprint_id: 12,
      print_provider_id: 29,
      is_visible: false, // 🔥 REVIEW FIRST
      variants: [
        { id: variant.id, price: 2900, is_enabled: true }
      ],
      print_areas: [{
        variant_ids: [variant.id],
        placeholders: [{
          position: "front",
          images: [{
            id: imageId,
            x: 0.5,
            y: 0.5,
            scale: 0.6, // 🔥 visible fix
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

    await sendSlackMessage(`✅ Draft created: ${product.title}`, channel);

  } catch (err) {
    console.log("❌ ERROR:", err.message);
    await sendSlackMessage(`❌ ${err.message}`, channel);
  }
}

// 🔁 DAILY
setInterval(async () => {
  for (let i = 0; i < 3; i++) {
    await createProduct("#general");
    if (i < 2) await sleep(5 * 60 * 1000);
  }
}, 1000 * 60 * 60 * 24);

// 🔄 RESET TOKENS
setInterval(() => {
  dailyTokenUsage = 0;
}, 1000 * 60 * 60 * 24);

// 🔥 SLACK
app.post("/slack/events", async (req, res) => {
  if (req.body.type === "url_verification") {
    return res.send(req.body.challenge);
  }

  res.sendStatus(200);

  const event = req.body.event;
  if (!event || event.bot_id) return;

  const text = event.text.toLowerCase();
  const channel = event.channel;

  if (text.includes("post now")) {
    await createProduct(channel);
  } else {
    const reply = await askGroq(event.text);
    if (reply) await sendSlackMessage(reply, channel);
  }
});

// 🧪 HEALTH
app.get("/", (_, res) => {
  res.send("🚀 Ben is alive (v2)");
});

app.listen(PORT, () => {
  console.log(`⚡ Running on port ${PORT}`);
});
