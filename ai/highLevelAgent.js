const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function executeHighLevel(bot, memoryContext) {
  const skillTreePath = path.join(__dirname, '../skills/tree.json');
  let skillTree = "No skill tree found.";
  if (fs.existsSync(skillTreePath)) {
    skillTree = fs.readFileSync(skillTreePath, 'utf8');
  }

  const taskTreePath = path.join(__dirname, '../skills/task_tree.json');
  let taskTree = "No task tree found.";
  if (fs.existsSync(taskTreePath)) {
    taskTree = fs.readFileSync(taskTreePath, 'utf8');
  }

  const configPath = path.join(__dirname, '../config.json');
  let config = { learningMode: false };
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  let experiencesText = "";
  if (config.learningMode) {
    const expPath = path.join(__dirname, '../skills/task_tree.ai_experience.json');
    if (fs.existsSync(expPath)) {
      const expData = fs.readFileSync(expPath, 'utf8');
      experiencesText = `\nHere are your Past Successful Experiences (Learning Mode is ON):\n${expData}\nYou can save new successful strategies by instructing the low-level agent to run mmskills.ai.saveExperience(topic, details).`;
    }
  }

  const promptText = `You are MineMate (High-Level Thought Process).
You are a highly capable AI planner for a Minecraft bot.
You are called when the low-level agent needs to think deeply, search for information, or plan a complex task.

Here is the current memory context:
${JSON.stringify(memoryContext.slice(-30))}

Here is the available searchable Skill Tree (JSON format):
${skillTree}

Here is the Super Large Task Tree showing milestones, objectives, and categories for your planning:
${taskTree}
${experiencesText}

Your task is to analyze the situation, use Google Search if necessary to find Minecraft crafting recipes, mechanics, or coordinates, and output a concise but detailed plan for the low-level agent. Explain what steps need to be taken and which skills from the skill tree should be used. 
Your output will be appended to the context memory so the low-level agent can read it and execute the code in subsequent loops.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro",
    contents: promptText,
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  return response.text;
}

async function executeFlashBack(bot, query, memoryContext) {
  const memoryPath = path.join(__dirname, '../skills/task_tree.spatial_memory.json');
  let memoryData = "No spatial memory found.";
  let images = [];
  
  if (fs.existsSync(memoryPath)) {
    try {
      const rawMemory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
      if (rawMemory.experiences && rawMemory.experiences.length > 0) {
        const memoriesText = rawMemory.experiences.map((m, idx) => {
           return `Memory ${idx}: [${m.topic}] Route: ${m.route}, Coordinates: ${m.coords}, ImagePath: ${m.screenshotFilename}`;
        }).join('\n');
        memoryData = memoriesText;
        
        for (const m of rawMemory.experiences) {
          if (m.screenshotFilename && fs.existsSync(m.screenshotFilename)) {
            const ext = path.extname(m.screenshotFilename).toLowerCase();
            let mimeType = 'image/jpeg';
            if (ext === '.png') mimeType = 'image/png';
            const imgBase64 = fs.readFileSync(m.screenshotFilename, 'base64');
            images.push({
              inlineData: {
                data: imgBase64,
                mimeType: mimeType
              }
            });
          }
        }
      }
    } catch(e) {
      console.error("FlashBack memory read error:", e);
    }
  }

  const promptText = `You are MineMate (FlashBack Memory Process).
You are called when the low-level agent needs to recall a spatial location, a route, or where things are.
Query: "${query}"

Here is the Spatial Memory Database:
${memoryData}
(Attached are screenshots corresponding to these memories, in case you need visual context.)

Analyze the query, the spatial text, and the images. Return a detailed explanation of what is where, the route to take, and the coordinates, so the low-level agent can find it. If you cannot find relevant information, just state so.`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro",
    contents: [promptText].concat(images)
  });

  return response.text;
}

module.exports = { executeHighLevel, executeFlashBack };
