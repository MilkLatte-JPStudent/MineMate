const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { validateCode } = require('./validator');

async function executeSkillCode(bot, codeStr, aiUtils = {}) {
  // The JSON parsing already handles \n if it's properly escaped in JSON strings,
  // but if the user requested explicit '\n' literal replacement, we handle it.
  const actualCode = codeStr.replace(/\\n/g, '\n');
  
  // AST Validation for security
  validateCode(actualCode);
  
  const mmskills = {
    move: {
      walk: async (direction, distanceInBlocks) => {
        ['forward', 'back', 'left', 'right'].forEach(d => bot.setControlState(d, false));
        bot.setControlState('sprint', false);
        bot.setControlState(direction, true);
        
        if (distanceInBlocks) {
          const startPos = bot.entity.position.clone();
          let lastPos = bot.entity.position.clone();
          let stuckCount = 0;
          while (bot.entity.position.distanceTo(startPos) < distanceInBlocks) {
            await new Promise(r => setTimeout(r, 100));
            if (bot.entity.position.distanceTo(lastPos) < 0.05) stuckCount++;
            else stuckCount = 0;
            if (stuckCount > 10) break; // Stuck for 1s
            lastPos = bot.entity.position.clone();
          }
          bot.setControlState(direction, false);
        }
      },
      run: async (direction, distanceInBlocks) => {
        ['forward', 'back', 'left', 'right'].forEach(d => bot.setControlState(d, false));
        bot.setControlState(direction, true);
        bot.setControlState('sprint', true);
        
        if (distanceInBlocks) {
          const startPos = bot.entity.position.clone();
          let lastPos = bot.entity.position.clone();
          let stuckCount = 0;
          while (bot.entity.position.distanceTo(startPos) < distanceInBlocks) {
            await new Promise(r => setTimeout(r, 100));
            if (bot.entity.position.distanceTo(lastPos) < 0.05) stuckCount++;
            else stuckCount = 0;
            if (stuckCount > 10) break;
            lastPos = bot.entity.position.clone();
          }
          bot.setControlState(direction, false);
          bot.setControlState('sprint', false);
        }
      },
      lookat: async (pitch, yaw) => {
        // Mineflayer expects yaw first, then pitch
        await bot.look(yaw, pitch, true);
      },
      jump: () => {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 250);
      },
      sneak: (state) => {
        if (state === 'on') bot.setControlState('sneak', true);
        else if (state === 'off') bot.setControlState('sneak', false);
        else if (state === 'toggle') bot.setControlState('sneak', !bot.controlState.sneak);
      }
    },
    block: {
      place: async (blockID) => {
        const item = bot.inventory.items().find(i => i.name === blockID);
        if (!item) return console.log("Block not in inventory:", blockID);
        await bot.equip(item, 'hand');
        const referenceBlock = bot.blockAtCursor(5);
        if (referenceBlock) {
          const vec3 = require('vec3');
          try { await bot.placeBlock(referenceBlock, vec3(0, 1, 0)); }
          catch (e) { console.log("Could not place block:", e.message); }
        } else {
          console.log("No reference block in sight to place on.");
        }
      },
      break: async () => {
        const targetBlock = bot.blockAtCursor(5);
        if (targetBlock) {
          try { await bot.dig(targetBlock); }
          catch (e) { console.log("Could not break block:", e.message); }
        } else {
          console.log("No block in sight to break.");
        }
      },
      interact: async () => {
        const targetBlock = bot.blockAtCursor(5);
        if (targetBlock) {
          try { await bot.activateBlock(targetBlock); }
          catch (e) { console.log("Could not interact with block:", e.message); }
        } else {
          console.log("No block in sight to interact with.");
        }
      }
    },
    entity: {
      interact: async () => {
        const target = typeof bot.entityAtCursor === 'function' ? bot.entityAtCursor(5) : bot.nearestEntity(e => bot.entity.position.distanceTo(e.position) < 5);
        if (target) {
          try { bot.useOn(target); } catch(e) { console.log("Could not interact with entity:", e.message); }
        } else {
          console.log("No entity in sight to interact with.");
        }
      },
      attack: async () => {
        const target = typeof bot.entityAtCursor === 'function' ? bot.entityAtCursor(5) : bot.nearestEntity(e => bot.entity.position.distanceTo(e.position) < 5 && (e.type === 'mob' || e.type === 'player' || e.type === 'animal'));
        if (target) {
          try { bot.attack(target); } catch(e) { console.log("Could not attack entity:", e.message); }
        } else {
          console.log("No entity in sight to attack.");
        }
      }
    },
    ai: {
      saveExperience: (topic, details) => {
        try {
          const configPath = path.join(__dirname, '../config.json');
          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.learningMode) {
              const expPath = path.join(__dirname, 'task_tree.ai_experience.json');
              let expData = { experiences: [] };
              if (fs.existsSync(expPath)) {
                expData = JSON.parse(fs.readFileSync(expPath, 'utf8'));
              }
              expData.experiences.push({ topic, details, timestamp: new Date().toISOString() });
              fs.writeFileSync(expPath, JSON.stringify(expData, null, 2), 'utf8');
              console.log(`AI Experience saved: [${topic}]`);
            } else {
              console.log("Learning mode is disabled in config.json.");
            }
          }
        } catch(e) {
          console.log("Could not save experience:", e.message);
        }
      },
      setEmergencyMode: (state, durationMs) => {
        if (aiUtils.setEmergencyMode) {
          aiUtils.setEmergencyMode(state, durationMs);
        } else {
          console.log("setEmergencyMode is not available in this context.");
        }
      }
    }
  };

  const context = {
    bot: bot,
    mmskills: mmskills,
    console: console,
    require: require,
    setTimeout: setTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    Promise: Promise
  };
  
  vm.createContext(context);
  
  try {
    const script = new vm.Script(`
      (async () => {
        ${actualCode}
      })();
    `);
    const resultPromise = script.runInContext(context);
    if (resultPromise && resultPromise.then) {
      await resultPromise;
    }
  } catch (err) {
    console.error("Skill error:", err);
    throw err;
  }
}

module.exports = { executeSkillCode };
