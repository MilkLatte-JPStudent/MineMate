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

module.exports = { executeHighLevel };
