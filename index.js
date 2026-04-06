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
const FAL_KEY = process.env.FAL_KEY; // Fallback Designer
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

// 🧠 MEMORY (light)
let conversationHistory = [];

// 🔒 TOKEN CONTROL
let dailyTokenUsage = 0;
const DAILY_TOKEN_LIMIT = 20000;

// 🎨 DESIGN RULES
let designSpecs = "Minimalist, bold typography, clean layout, flat vector style, isolated on a pure white background.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch {}

// 🔄 GROQ MODELS (For Text & Brains)
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];

// 🤖 GROQ API CALL
async function askGroq(prompt, maxTokens = 500) {
  let lastError = null;

  for (const model of GROQ_MODELS) {
    try {
      const estimatedTokens = prompt.length / 4;

      if (dailyTokenUsage + estimatedTokens > DAILY_TOKEN_LIMIT) {
        return "⚠️ Daily AI limit reached.";
      }

      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [
            ...conversationHistory,
            { role: "user", content: prompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      const reply = response.data.choices?.[0]?.message?.content || "";
      dailyTokenUsage += estimatedTokens;

      conversationHistory.push({ role: "user", content: prompt });
      conversationHistory.push({ role: "assistant", content: reply });
      conversationHistory = conversationHistory.slice(-4);

      return reply;

    } catch (err) {
      lastError = err;
      if (err.response?.data?.code === "model_permission_blocked_project") {
        continue; 
      } else {
        console.error("Groq Error:", err.response?.data || err.message);
        return null;
      }
    }
  }
  return null;
}

// 🧠 SAFE JSON PARSER
function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// 📊 1. MARKET RESEARCH
async function performMarketResearch() {
  const prompt = `
Find ONE profitable, low-competition t-shirt niche right now.
Return ONE short phrase only. Example: "Retro 70s optimistic quotes"
`;
  const result = await askGroq(prompt, 100);
  return result?.trim() || "minimalist stoic quotes";
}

// 🎯 2. PRODUCT DATA
async function generateProductData(niche) {
  const prompt = `
Create Etsy listing JSON for niche: "${niche}"
Return ONLY JSON:
{
  "title": "...",
  "description": "...",
  "tags": ["","","","","","","","","",""]
}
`;
  const raw = await askGroq(prompt, 800);
  const parsed = extractJSON(raw);
  if (!parsed || !parsed.title) throw new Error("Invalid AI JSON output");
  return parsed;
}

// 🎨 3. GENERATE DESIGN PROMPT
async function generateDesignPrompt(niche) {
  const prompt = `
Write a prompt for an AI image generator to design a t-shirt graphic for this niche: "${niche}".
Rules:
- Must follow this style: ${designSpecs}
- No backgrounds (pure white).
- Keep it to 2 sentences max.
Return ONLY the prompt text, nothing else.
`;
  const designPrompt = await askGroq(prompt, 200);
  return designPrompt || `A minimalist typography design for ${niche}, bold font, clean, pure white background.`;
}

// 🖌️ 4A. GEMINI IMAGE GENERATOR
async function callGeminiImage(imagePrompt) {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [
        { parts: [{ text: imagePrompt }] }
      ]
    },
    { headers: { "Content-Type": "application/json" } }
  );

  const parts = response.data.candidates[0].content.parts;
  const imagePart = parts.find(p => p.inlineData);

  if (!imagePart) throw new Error("No image data returned from Gemini.");
  return imagePart.inlineData.data; // Returns pure base64
}

// 🖌️ 4B. FAL.AI IMAGE GENERATOR (Fallback)
async function callFalImage(imagePrompt) {
  const response = await axios.post(
    "https://fal.run/fal-ai/flux/schnell",
    {
      prompt: imagePrompt,
      image_size: "square_hd"
    },
    {
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const imageUrl = response.data.images[0].url;
  
  // Convert URL to Base64 in memory
  const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  return Buffer.from(imgResponse.data, 'binary').toString('base64');
}

// 🖌️ 4C. THE MASTER IMAGE ROUTER
async function generateImage(imagePrompt) {
  try {
    console.log("🎨 Attempting to draw with Gemini...");
    return await callGeminiImage(imagePrompt);
  } catch (err) {
    console.log(`⚠️ Gemini failed (${err.message}). Switching to FAL (Flux)...`);
    try {
      return await callFalImage(imagePrompt);
    } catch (falErr) {
      console.error("❌ FAL Image Error:", falErr.response?.data || falErr.message);
      throw new Error("Both Gemini and FAL designers are currently offline.");
    }
  }
}

// 📤 5. UPLOAD TO PRINTIFY (Base64 Mode)
async function uploadToPrintify(imageData, niche) {
  const safeName = niche.replace(/[^a-z0-9]/gi, '_').toLowerCase() + `_${Date.now()}.png`;

  const response = await axios.post(
    "https://api.printify.com/v1/uploads/images.json",
    {
      file_name: safeName,
      contents: imageData // Sending the raw Base64 image payload
    },
    {
      headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
    }
  );
  return response.data.id;
}

// 📢 SLACK MESSAGE
async function sendSlackMessage(text, channel) {
  if (!channel) return;
  await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, text },
    {
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// 🛒 CREATE PRODUCT FLOW (Fully Autonomous)
async function createProduct(channel = null) {
  try {
    await sendSlackMessage("📊 Researching market...", channel);
    const niche = await performMarketResearch();
    await sendSlackMessage(`🎯 Niche acquired: *${niche}*`, channel);

    await sendSlackMessage(`📝 Writing SEO listing...`, channel);
    const product = await generateProductData(niche);

    await sendSlackMessage(`🎨 Generating custom design idea...`, channel);
    const imagePrompt = await generateDesignPrompt(niche);

    const imageData = await generateImage(imagePrompt);

    await sendSlackMessage(`📤 Uploading fresh design to Printify...`, channel);
    const imageId = await uploadToPrintify(imageData, niche);

    await sendSlackMessage("🛒 Assembling product and pushing to shop...", channel);

    const catalog = await axios.get(
      "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
      { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
    );
    const variantId = catalog.data.variants?.[0]?.id;

    const payload = {
      title: product.title,
      description: product.description,
      tags: product.tags,
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
            scale: 0.2, // Tweak this if the designs print too big/small
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

    await sendSlackMessage(`✅ *Product successfully designed and published!*\n${product.title}`, channel);
    return product.title;

  } catch (err) {
    console.error(err);
    await sendSlackMessage(`❌ Error creating product: ${err.message}`, channel);
  }
}

// 🔁 AUTO POSTER
setInterval(async () => {
  console.log("🤖 Running daily auto-batch posting...");
  try {
    for (let i = 0; i < 3; i++) {
      await createProduct("#general");
    }
  } catch (err) {
    console.error("Batch Error:", err.message);
  }
}, 1000 * 60 * 60 * 24);

// 🔄 RESET TOKENS DAILY
setInterval(() => {
  dailyTokenUsage = 0;
  console.log("🔄 Tokens reset");
}, 1000 * 60 * 60 * 24);

// 🔥 SLACK EVENTS ENDPOINT
app.post("/slack/events", async (req, res) => {
  const body = req.body;

  if (body.type === "url_verification") return res.send(body.challenge);

  res.status(200).send("OK");

  if (body.event && body.event.type === "message" && !body.event.bot_id) {
    const text = body.event.text;
    const channel = body.event.channel;

    if (text.toLowerCase().includes("create product") || text.toLowerCase().includes("post now")) {
      await createProduct(channel);
    } else {
      const reply = await askGroq(text);
      if (reply) await sendSlackMessage(reply, channel);
    }
  }
});

// 🧪 HEALTH CHECK
app.get("/", (req, res) => {
  res.send("🚀 Ben is alive, designing with Gemini/Fal, and fully automated");
});

// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`⚡ Server running on port ${PORT}`);
});
