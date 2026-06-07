const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { executeHighLevel, executeFlashBack } = require('./highLevelAgent');
const { executeSkillCode } = require('../skills/executor');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    Chat: { type: "string" },
    Thought: { type: "string", description: "Internal notes, observations, or thoughts about what you did, heard, or saw." },
    Execute: { type: "string", enum: ["Start", "Stop", "Thinking", "FlashBack", "LongMemory", "None"] },
    Query: { type: "string", description: "Required if Execute is FlashBack. What to recall." },
    Action: {
      type: "object",
      description: "Required if Execute is LongMemory.",
      properties: {
        Write: {
          type: "object",
          properties: {
            Title: { type: "string" },
            Contents: { type: "string" }
          }
        },
        Query: { type: "string" }
      }
    },
    Code: { type: "string", description: "Included only if Execute is Start. Newlines must be encoded as \\n" },
    EmergencyMode: {
      type: "object",
      description: "Optional. Set emergency polling mode manually.",
      properties: {
        state: { type: "string", enum: ["on", "off", "toggle", "time"] },
        durationMs: { type: "number", description: "Required if state is time." }
      }
    }
  },
  required: ["Chat", "Execute"]
};

let memoryContext = [];
let soundsThisLoop = [];
let chatQueue = [];
let isScriptRunning = false;
let previousHealth = 20;
let manualEmergencyMode = false;
let emergencyTimeout = null;

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function setEmergencyMode(state, durationMs) {
  if (state === 'on') {
    manualEmergencyMode = true;
    if (emergencyTimeout) { clearTimeout(emergencyTimeout); emergencyTimeout = null; }
  } else if (state === 'off') {
    manualEmergencyMode = false;
    if (emergencyTimeout) { clearTimeout(emergencyTimeout); emergencyTimeout = null; }
  } else if (state === 'toggle') {
    manualEmergencyMode = !manualEmergencyMode;
    if (emergencyTimeout) { clearTimeout(emergencyTimeout); emergencyTimeout = null; }
  } else if (state === 'time') {
    manualEmergencyMode = true;
    if (emergencyTimeout) clearTimeout(emergencyTimeout);
    emergencyTimeout = setTimeout(() => {
      manualEmergencyMode = false;
    }, durationMs || 1000);
  }
}

function recordChatEvent(username, message) {
  chatQueue.push(`<${username}> ${message}`);
  if (chatQueue.length > 55) {
    chatQueue.shift();
  }
}

function recordSoundEvent(bot, soundName, soundCategory, position, volume, pitch) {
  const dx = position.x - bot.entity.position.x;
  const dy = position.y - bot.entity.position.y;
  const dz = position.z - bot.entity.position.z;
  const distance = Math.sqrt(dx*dx + dy*dy + dz*dz).toFixed(1);
  soundsThisLoop.push(`Heard [${soundCategory}] ${soundName} from distance ${distance} at direction vector (${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)})`);
}

async function callLowLevelGemini(bot, frames) {
  const pos = bot.entity.position;
  const yaw = bot.entity.yaw; 
  const pitch = bot.entity.pitch;
  const stateStr = `Coordinates: X=${pos.x.toFixed(2)}, Y=${pos.y.toFixed(2)}, Z=${pos.z.toFixed(2)}. Yaw=${yaw.toFixed(2)}, Pitch=${pitch.toFixed(2)}. [Script Running: ${isScriptRunning ? "YES" : "NO"}]`;
  
  const promptText = `You are MineMate, a Minecraft AI bot. You must respond in JSON matching the schema.
If you have enough information to act, return Execute: 'Start' and write a complete, autonomous JavaScript script in 'Code'. You can use standard JS (loops, variables, conditionals) combined with 'mmskills' and 'botAPI' (for direct bot access like chat or control states) to assemble a full processing sequence.
If you need to think deeply, plan, or use a skill tree/Google Search, return Execute: 'Thinking'.
If you need to recall a spatial memory (a saved location, route, or coordinate) with screenshots using high-level AI, return Execute: 'FlashBack' and set 'Query' to what you want to recall.
If you want to save a screenshot and memory for yourself, return Execute: 'LongMemory' with Action: {Write: {Title: '...', Contents: '...'}}.
If you want to search your LongMemory database, return Execute: 'LongMemory' with Action: {Query: '...'}.
If you need to stop current actions, return Execute: 'Stop'.
If a script is currently running and you want to let it continue without interfering, return Execute: 'None'.
Current State: ${stateStr}
Recent Sounds: ${soundsThisLoop.length > 0 ? soundsThisLoop.join("; ") : "None"}
Recent Game Chat (Last 55 messages): ${chatQueue.length > 0 ? "\n" + chatQueue.join("\n") : "None"}
Context/Memory: ${JSON.stringify(memoryContext.slice(-20))}
Below are the video frames (at 7fps) since the last query. Analyze them visually.`;

  soundsThisLoop = []; // clear sounds

  const promptParts = [promptText];

  const imageParts = frames.map(f => ({
    inlineData: {
      data: f,
      mimeType: "image/jpeg"
    }
  }));

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash",
    contents: promptParts.concat(imageParts),
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA
    }
  });

  return JSON.parse(response.text);
}

async function startAgentLoop(bot, captureSession) {
  console.log("Starting agent loop...");
  while (true) {
    try {
      const frames = captureSession.getAndClearFrames();
      if (frames.length === 0) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      const response = await callLowLevelGemini(bot, frames);
      console.log("Low-level AI Response:", JSON.stringify(response));
      
      if (response.Chat) {
        bot.chat(response.Chat);
        memoryContext.push(`Bot said: ${response.Chat}`);
      }

      if (response.Thought) {
        memoryContext.push(`AI Thought: ${response.Thought}`);
      }

      if (response.EmergencyMode) {
        setEmergencyMode(response.EmergencyMode.state, response.EmergencyMode.durationMs);
        memoryContext.push(`Set emergency mode to ${response.EmergencyMode.state}`);
      }

      if (response.Execute === "Thinking") {
        console.log("Delegating to High-Level Agent...");
        const highLevelPlan = await executeHighLevel(bot, memoryContext);
        memoryContext.push(`High level thought: ${highLevelPlan}`);
      } else if (response.Execute === "FlashBack") {
        console.log("FlashBack Triggered...");
        const flashbackRecall = await executeFlashBack(bot, response.Query || "Recall requested", memoryContext);
        memoryContext.push(`FlashBack memory recall: ${flashbackRecall}`);
      } else if (response.Execute === "LongMemory" && response.Action) {
        if (response.Action.Write) {
          const title = response.Action.Write.Title;
          const contents = response.Action.Write.Contents;
          
          const ts = Date.now();
          const screenshotsDir = path.join(__dirname, '../screenshots');
          if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
          const screenshotPath = path.join(screenshotsDir, `long_memory_${ts}.jpg`);
          await captureSession.takeHighResScreenshot(screenshotPath);
          
          const embedRes = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: title
          });
          const embedding = embedRes.embeddings[0].values;
          
          const memoryPath = path.join(__dirname, '../skills/LongMemory.json');
          let memories = [];
          if (fs.existsSync(memoryPath)) memories = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
          memories.push({ title, contents, screenshotPath, embedding, timestamp: new Date().toISOString() });
          fs.writeFileSync(memoryPath, JSON.stringify(memories), 'utf8');
          
          memoryContext.push(`Saved LongMemory: [${title}]`);
        } else if (response.Action.Query) {
          const query = response.Action.Query;
          const embedRes = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: query
          });
          const queryEmb = embedRes.embeddings[0].values;
          
          const memoryPath = path.join(__dirname, '../skills/LongMemory.json');
          let memories = [];
          if (fs.existsSync(memoryPath)) memories = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
          
          if (memories.length > 0) {
            for (const m of memories) {
              m.score = cosineSimilarity(queryEmb, m.embedding);
            }
            memories.sort((a, b) => b.score - a.score);
            const best = memories[0];
            if (best.score > 0.5) {
              memoryContext.push(`Recalled LongMemory [Similarity: ${best.score.toFixed(2)}]: Title: ${best.title}, Contents: ${best.contents}, Screenshot path: ${best.screenshotPath}`);
            } else {
              memoryContext.push(`No relevant LongMemory found for query: ${query}`);
            }
          } else {
            memoryContext.push(`LongMemory database is empty.`);
          }
        }
      } else if (response.Execute === "Start" && response.Code) {
        console.log("Executing code...");
        isScriptRunning = true;
        memoryContext.push(`Started executing new code.`);
        executeSkillCode(bot, response.Code, { setEmergencyMode, captureSession }).catch(err => {
          console.error("Script Error:", err.message);
          memoryContext.push(`Script Error: ${err.message}`);
        }).finally(() => {
          isScriptRunning = false;
        });
      } else if (response.Execute === "Stop") {
        console.log("Agent requested stop.");
        bot.clearControlStates();
        memoryContext.push(`Stopped current actions.`);
      } else if (response.Execute === "None") {
        console.log("Agent chose to do nothing.");
      }
      
      let waitTime = 1200;
      const currentHealth = bot.health;
      const nearestHostile = bot.nearestEntity ? bot.nearestEntity(e => (e.type === 'mob') && bot.entity.position.distanceTo(e.position) < 8) : null;
      
      if (currentHealth < previousHealth || nearestHostile || manualEmergencyMode) {
        waitTime = 200;
      }
      previousHealth = currentHealth;
      
      await new Promise(r => setTimeout(r, waitTime));
      
    } catch (e) {
      console.error("Agent Loop Error:", e.message);
      await new Promise(r => setTimeout(r, 1200));
    }
  }
}

module.exports = { startAgentLoop, memoryContext, recordSoundEvent, recordChatEvent };
