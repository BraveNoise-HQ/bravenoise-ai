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

// ⏳ Sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 🧠 Memory
let conversationHistory = [];
let usedNiches = new Set();

// 🔒 Token Control
let dailyTokenUsage = 0;
const DAILY_TOKEN_LIMIT = 20000;

// 📊 Daily Stats
let stats = { created: 0 };

// 🎨 Design Rules
let designSpecs = "Minimalist, bold typography, clean layout, flat vector style, white background.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch {}

// 🤖 GROQ
const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

async function askGroq(prompt, maxTokens = 500) {
  for (const model of MODELS) {
    try {
      const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [...conversationHistory, { role: "user", content: prompt }],
          max_tokens: maxTokens
        },
        { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
      );

      const reply = res.data.choices?.[0]?.message?.content || "";
      conversationHistory = [...conversationHistory, { role: "user", content: prompt }, { role: "assistant", content: reply }].slice(-4);
      return reply;

    } catch (err) {
      if (err.response?.data?.code !== "model_permission_blocked_project") {
        console.error(err.message);
        return null;
      }
    }
  }
  return null;
}

// 🧠 JSON Extract
const extractJSON = (t) => {
  try { return JSON.parse(t.match(/\{[\s\S]*\}/)[0]); }
  catch { return null; }
};

// 📊 Market Research (no duplicates)
async function performMarketResearch() {
  for (let i = 0; i < 5; i++) {
    const niche = (await askGroq("Give ONE profitable t-shirt niche (short phrase)."))?.trim();
    if (niche && !usedNiches.has(niche)) {
      usedNiches.add(niche);
      return niche;
    }
  }
  return "minimalist stoic quotes";
}

// 🎯 Product Data
async function generateProductData(niche) {
  const raw = await askGroq(`
Create Etsy listing JSON for "${niche}"

{
"title": "...",
"description": "...",
"tags": ["","","","","","","","","",""]
}
`);
  const parsed = extractJSON(raw);
  if (!parsed?.title) throw new Error("Bad JSON");
  return parsed;
}

// 🎨 Prompt
async function generateDesignPrompt(niche, variation) {
  return await askGroq(`
Create a t-shirt design prompt for "${niche}".
Variation idea: ${variation}
Style: ${designSpecs}
Max 2 sentences.
`);
}

// 🖌️ Gemini
async function gemini(prompt) {
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }] }
  );
  const part = res.data.candidates[0].content.parts.find(p => p.inlineData);
  if (!part) throw new Error("No image");
  return part.inlineData.data;
}

// 🖌️ FAL fallback
async function fal(prompt) {
  const res = await axios.post("https://fal.run/fal-ai/flux/schnell",
    { prompt, image_size: "square_hd" },
    { headers: { Authorization: `Key ${FAL_KEY}` } }
  );
  const img = await axios.get(res.data.images[0].url, { responseType: "arraybuffer" });
  return Buffer.from(img.data).toString("base64");
}

// 🖌️ Router
async function generateImage(prompt) {
  try { return await gemini(prompt); }
  catch { return await fal(prompt); }
}

// 📤 Upload
async function upload(image, niche) {
  const res = await axios.post(
    "https://api.printify.com/v1/uploads/images.json",
    { file_name: `${niche}_${Date.now()}.png`, contents: image },
    { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
  );
  return res.data.id;
}

// 🛒 Create Product
async function createProduct(channel = null) {
  try {
    const niche = await performMarketResearch();
    await sendSlack(`🎯 ${niche}`, channel);

    const product = await generateProductData(niche);

    for (let i = 1; i <= 3; i++) {
      await sendSlack(`🎨 Design ${i}/3`, channel);

      const prompt = await generateDesignPrompt(niche, `Variation ${i}`);
      const image = await generateImage(prompt);

      await sleep(1500);
      const imageId = await upload(image, niche);

      const catalog = await axios.get(
        "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
        { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
      );

      const variantId = catalog.data.variants.find(v => v.is_enabled)?.id;
      if (!variantId) throw new Error("No variant");

      const payload = {
        title: product.title + ` V${i}`,
        description: product.description,
        tags: product.tags,
        blueprint_id: 12,
        print_provider_id: 29,
        visible: false, // 👈 stays in Printify for review
        variants: [{ id: variantId, price: 2900, is_enabled: true }],
        print_areas: [{
          variant_ids: [variantId],
          placeholders: [{
            position: "front",
            images: [{ id: imageId, x: 0.5, y: 0.5, scale: 0.2, angle: 0 }]
          }]
        }]
      };

      await axios.post(
        `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/products.json`,
        payload,
        { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
      );

      stats.created++;
      await sleep(2000);
    }

    await sendSlack("✅ 3 designs created (ready for review in Printify)", channel);

  } catch (err) {
    console.error(err);
    await sendSlack(`❌ ${err.message}`, channel);
  }
}

// 📢 Slack
async function sendSlack(text, channel) {
  if (!channel) return;
  await axios.post("https://slack.com/api/chat.postMessage",
    { channel, text },
    { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
  );
}

// 📊 Daily Report
setInterval(async () => {
  await sendSlack(`📊 Daily Report:\nProducts Created: ${stats.created}`, "#general");
  stats = { created: 0 };
  dailyTokenUsage = 0;
}, 1000 * 60 * 60 * 24);

// 🔁 Auto Run
setInterval(async () => {
  await createProduct("#general");
}, 1000 * 60 * 60 * 12);

// 🔥 Slack Commands
app.post("/slack/events", async (req, res) => {
  const b = req.body;
  if (b.type === "url_verification") return res.send(b.challenge);
  res.sendStatus(200);

  const txt = b.event?.text?.toLowerCase() || "";
  const ch = b.event?.channel;

  if (txt.includes("post now")) await createProduct(ch);
});

// 🧪 Health
app.get("/", (_, res) => res.send("Ben v2 is live 🚀"));

app.listen(PORT, () => console.log(`⚡ Running on ${PORT}`));
