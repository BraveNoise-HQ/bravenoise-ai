import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 8080;

// 🔐 ENV VARIABLES
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN;
const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;

// 🧠 MEMORY (light)
let conversationHistory = [];

// 🔒 TOKEN CONTROL
let dailyTokenUsage = 0;
const DAILY_TOKEN_LIMIT = 20000;

// 🎨 DESIGN RULES
let designSpecs = "Minimalist, bold typography, clean layout.";
try {
  if (fs.existsSync("./DESIGN.md")) {
    designSpecs = fs.readFileSync("./DESIGN.md", "utf8");
  }
} catch {}

// 🤖 GROQ API CALL (Upgraded to 70B Model for better reasoning)
async function askGroq(prompt, maxTokens = 500) {
  try {
    const estimatedTokens = prompt.length / 4;

    if (dailyTokenUsage + estimatedTokens > DAILY_TOKEN_LIMIT) {
      console.log("⚠️ Token limit reached");
      return null;
    }

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile", // Much better at SEO and JSON generation
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

    // Keep memory light (last 4 messages)
    conversationHistory.push({ role: "user", content: prompt });
    conversationHistory.push({ role: "assistant", content: reply });
    conversationHistory = conversationHistory.slice(-4);

    return reply;

  } catch (err) {
    console.error("Groq Error:", err.response?.data || err.message);
    return null;
  }
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

// 📊 STEP 1: DYNAMIC MARKET RESEARCH
async function performMarketResearch() {
  console.log("📊 Conducting live market research...");
  const prompt = `
You are an expert Print-on-Demand market researcher.
Analyze current consumer trends, aesthetic movements, and Etsy demand.
Identify ONE highly profitable, low-competition niche or aesthetic for a t-shirt right now.

Return ONLY a single, short sentence describing the niche. 
Example: "Retro 70s wavy font optimistic mental health quotes"
Do NOT include quotes, intros, or extra text. Just the niche.
  `;

  const researchResult = await askGroq(prompt, 100);
  const niche = researchResult ? researchResult.trim() : "minimalist stoic quotes"; // Fallback just in case
  
  console.log(`🎯 Research Complete. Target Niche: ${niche}`);
  return niche;
}

// 🎯 STEP 2: GENERATE PRODUCT DATA
async function generateProductData(niche) {
  const prompt = `
You are a top 1% Etsy SEO expert.
Using this exact market research niche: "${niche}"
Create the perfect product listing.

Return ONLY valid JSON:
{
  "title": "...",
  "description": "...",
  "tags": ["","","","","","","","","",""]
}

RULES:
TITLE: 120-140 characters, SEO optimized, readable.
DESCRIPTION: Strong first line hook, clean formatting, no AI/meta text.
TAGS: Exactly 10 real Etsy search phrases.
STYLE: ${designSpecs}
`;

  const raw = await askGroq(prompt, 800);
  const parsed = extractJSON(raw);

  if (!parsed || !parsed.title) {
    throw new Error("Invalid AI JSON output");
  }

  return parsed;
}

// 🖼 STEP 3: GET IMAGE
async function getLatestImage() {
  const res = await axios.get("https://api.printify.com/v1/uploads.json?limit=1", {
    headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
  });

  return res.data.data?.[0]?.id;
}

// 🛒 STEP 4: ASSEMBLE & CREATE PRODUCT
async function createProduct(channel = null) {
  // 1. Research
  if (channel) await sendSlackMessage("📊 Conducting market research...", channel);
  const niche = await performMarketResearch();
  
  // 2. Generate SEO Data
  if (channel) await sendSlackMessage(`🎯 Target Niche acquired: *${niche}*\n✍️ Writing SEO listing...`, channel);
  const product = await generateProductData(niche);
  
  // 3. Get Design
  if (channel) await sendSlackMessage("🖼 Fetching latest design from Printify...", channel);
  const imageId = await getLatestImage();
  if (!imageId) throw new Error("No image found in Printify uploads.");

  // 4. Get Printify Blueprint
  const catalog = await axios.get(
    "https://api.printify.com/v1/catalog/blueprints/12/print_providers/29/variants.json",
    { headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` } }
  );
  const variantId = catalog.data.variants?.[0]?.id;

  // 5. Push to Etsy/Printify
  if (channel) await sendSlackMessage("🛒 Pushing product to shop...", channel);
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

  return product.title;
}

// 📢 SLACK MESSAGE SENDER
async function sendSlackMessage(text, channel) {
  try {
    await axios.post("https://slack.com/api/chat.postMessage", {
      channel,
      text
    }, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
    });
  } catch (err) {
    console.error("Failed to send Slack message:", err.message);
  }
}

// 🔁 AUTO POST (3 PRODUCTS DAILY)
setInterval(async () => {
  console.log("🤖 Level 3 batch posting initiated...");
  try {
    for (let i = 0; i < 3; i++) {
      const title = await createProduct();
      await sendSlackMessage(`🚀 *Auto-Batch Product ${i + 1} created:*\n${title}`, "#general");
    }
  } catch (err) {
    console.error("Batch Error:", err.message);
    await sendSlackMessage(`🚨 *Auto-Batch Error:* ${err.message}`, "#general");
  }
}, 1000 * 60 * 60 * 24);

// 🔄 RESET TOKENS DAILY
setInterval(() => {
  dailyTokenUsage = 0;
  console.log("🔄 Tokens reset");
}, 1000 * 60 * 60 * 24);

// 💬 SLACK EVENTS HANDLER
app.post("/slack/events", async (req, res) => {
  if (req.headers['x-slack-retry-num']) return res.status(200).send("OK");

  const { body } = req;

  if (body.type === "url_verification") {
    return res.send({ challenge: body.challenge });
  }

  // Acknowledge immediately so Slack doesn't timeout
  res.status(200).send("OK");

  const event = body.event;

  // Process message if it exists and isn't from a bot
  if (event?.text && !event.bot_id) {
    const text = event.text.toLowerCase();
    console.log(`💬 Slack message: "${text}"`); 

    try {
      if (text.includes("post now")) {
        const title = await createProduct(event.channel);
        await sendSlackMessage(`✅ *Product successfully created!*\n${title}`, event.channel);
        return;
      }

      if (text.includes("post 3")) {
        await sendSlackMessage("⏳ Starting batch sequence of 3 products...", event.channel);
        for (let i = 0; i < 3; i++) {
          const title = await createProduct(event.channel);
          await sendSlackMessage(`✅ *Product ${i+1}/3 created!*\n${title}`, event.channel);
        }
        await sendSlackMessage("🎉 Batch sequence complete.", event.channel);
        return;
      }

      // Standard chat bot response
      await sendSlackMessage("🤔 Let me think about that...", event.channel);

      const reply = await askGroq(`
You are Ben, an AI business operator focused on Etsy growth.
Be concise, professional, and actionable.
User: ${event.text}
`);

      if (reply) {
        await sendSlackMessage(reply, event.channel);
      } else {
        await sendSlackMessage("⚠️ I hit an error thinking about that. Check the terminal logs.", event.channel);
      }

    } catch (err) {
      console.error("Action Error:", err.message);
      await sendSlackMessage(`🚨 *Error executing command:* ${err.message}`, event.channel);
    }
  }
});

// HEALTH
app.get("/", (req, res) => {
  res.send("🚀 Ben Level 4 running (Research Mode Enabled)");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Ben Level 4 LIVE via Groq API on port ${PORT}`);
});  "alpha male focus motivation",
  "deep work productivity mindset",
  "self mastery stoicism",
  "no excuses fitness mindset",
  "clean typography motivation",
  "modern minimal confidence quote",
  "success driven lifestyle"
;

// 🤖 GROQ API CALL
async function askGroq(prompt) {
  try {
    const estimatedTokens = prompt.length / 4;

    if (dailyTokenUsage + estimatedTokens > DAILY_TOKEN_LIMIT) {
      console.log("⚠️ Token limit reached");
      return null;
    }

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant", // Updated to a Groq model
        messages: [
          ...conversationHistory,
          { role: "user", content: prompt }
        ],
        max_tokens: 250,
        temperature: 0.6
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`, // Swapped to use Groq API Key
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
    console.error("Groq Error:", err.response?.data || err.message);
    return null;
  }
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

// 🎯 GENERATE PRODUCT
async function generateProductData() {
  const niche = NICHE_COMBINATIONS[Math.floor(Math.random() * NICHE_COMBINATIONS.length)];

  const prompt = `
You are a top 1% Etsy SEO expert.

Return ONLY JSON:

{
  "title": "...",
  "description": "...",
  "tags": ["","","","","","","","","",""]
}

RULES:

TITLE:
- 120-140 characters
- SEO optimized

DESCRIPTION:
- Strong first line hook
- Clean formatting
- No AI/meta text

TAGS:
- 10 real Etsy search phrases

NICHE: ${niche}
STYLE: ${designSpecs}
`;

  const raw = await askGroq(prompt); // Updated function call
  const parsed = extractJSON(raw);

  if (!parsed || !parsed.title) {
    throw new Error("Invalid AI output");
  }

  return parsed;
}

// 🖼 GET IMAGE
async function getLatestImage() {
  const res = await axios.get("https://api.printify.com/v1/uploads.json?limit=1", {
    headers: { Authorization: `Bearer ${PRINTIFY_TOKEN}` }
  });

  return res.data.data?.[0]?.id;
}

// 🛒 CREATE PRODUCT
async function createProduct() {
  const product = await generateProductData();
  const imageId = await getLatestImage();

  if (!imageId) throw new Error("No image found");

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

  return product.title;
}

// 📢 SLACK MESSAGE
async function sendSlackMessage(text, channel) {
  await axios.post("https://slack.com/api/chat.postMessage", {
    channel,
    text
  }, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` }
  });
}

// 🔁 AUTO POST (3 PRODUCTS DAILY)
setInterval(async () => {
  console.log("🤖 Level 3 batch posting...");

  try {
    for (let i = 0; i < 3; i++) {
      const title = await createProduct();

      await sendSlackMessage(
        `🚀 Product ${i + 1} created:\n${title}`,
        "#general"
      );
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
      if (text.includes("post now")) {
        const title = await createProduct();
        await sendSlackMessage(`🚀 Product created:\n${title}`, event.channel);
        return;
      }

      if (text.includes("post 3")) {
        for (let i = 0; i < 3; i++) {
          const title = await createProduct();
          await sendSlackMessage(`🚀 ${title}`, event.channel);
        }
        return;
      }

      if (!text.includes("product") && !text.includes("etsy") && !text.includes("idea")) {
        return;
      }

      const reply = await askGroq(` // Updated function call
You are Ben, an AI business operator focused on Etsy growth.

Be concise and actionable.

User: ${event.text}
`);

      if (reply) {
        await sendSlackMessage(reply, event.channel);
      }

    } catch (err) {
      console.error("Slack Error:", err.message);
    }
  }
});

// HEALTH
app.get("/", (req, res) => {
  res.send("🚀 Ben Level 3 running (money mode)");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Ben Level 3 LIVE via Groq API");
});
