const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

let isUIOpenState = false;

async function executeSkillCode(bot, codeStr, aiUtils = {}) {
  if (!bot._uiStateListenerAttached) {
    bot._uiStateListenerAttached = true;
    bot.on('windowOpen', (window) => {
      isUIOpenState = true;
      setTimeout(() => {
        isUIOpenState = false;
      }, 80);
    });
  }

  const actualCode = codeStr.replace(/\\n/g, '\n');
  
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
    inventory: {
      items: () => {
        // Return serialized items
        return bot.inventory.items().map(item => ({
          type: item.type,
          count: item.count,
          name: item.name,
          displayName: item.displayName,
          slot: item.slot,
          metadata: item.metadata
        }));
      },
      unequip: async (destination) => {
        try { await bot.unequip(destination); } catch(e) { console.log("Could not unequip:", e.message); }
      },
      equip: async (itemIdentifier, destination) => {
        let itemToEquip;
        if (typeof itemIdentifier === 'object' && itemIdentifier !== null) {
          itemToEquip = bot.inventory.items().find(i => i.type === itemIdentifier.type || i.name === itemIdentifier.name);
        } else if (typeof itemIdentifier === 'string' || typeof itemIdentifier === 'number') {
          itemToEquip = bot.inventory.items().find(i => i.name === itemIdentifier || i.type === itemIdentifier);
        }
        
        if (itemToEquip) {
          try { await bot.equip(itemToEquip, destination); } catch(e) { console.log("Could not equip:", e.message); }
        } else {
          console.log("Could not equip: Item not found in inventory.");
        }
      },
      toss: async (itemType, metadata, count) => {
        try { await bot.toss(itemType, metadata, count); } catch(e) { console.log("Could not toss:", e.message); }
      },
      craft: async (gridType, targetItemIdentifier) => {
        try {
          let targetItemType;
          if (typeof targetItemIdentifier === 'object' && targetItemIdentifier !== null) {
            targetItemType = targetItemIdentifier.type;
          } else if (typeof targetItemIdentifier === 'string') {
            const item = bot.registry.itemsByName[targetItemIdentifier];
            if (!item) throw new Error(`Item ${targetItemIdentifier} not found in registry`);
            targetItemType = item.id;
          } else {
            targetItemType = targetItemIdentifier;
          }

          let craftingTable = null;
          if (gridType === '3x3') {
            craftingTable = bot.blockAtCursor(5);
            if (!craftingTable || craftingTable.name !== 'crafting_table') {
              throw new Error("You must be looking at a crafting_table to use 3x3 grid.");
            }
          }

          const recipes = bot.recipesFor(targetItemType, null, 1, craftingTable);
          if (recipes.length === 0) {
            throw new Error(`No recipes found for item ID ${targetItemType}. Maybe missing ingredients or no crafting table?`);
          }

          await bot.craft(recipes[0], 1, craftingTable);
          console.log(`Successfully crafted item ID ${targetItemType}`);
        } catch(e) {
          console.log("Could not craft:", e.message);
          throw e;
        }
      },
      isOpenUI: () => {
        return isUIOpenState;
      }
    },
    window: {
      current: () => {
        if (!bot.currentWindow) return null;
        return {
          id: bot.currentWindow.id,
          type: bot.currentWindow.type,
          title: bot.currentWindow.title,
          slots: bot.currentWindow.slots.map(s => s ? { type: s.type, count: s.count, name: s.name, slot: s.slot } : null)
        };
      },
      leftClick: async (slotId) => {
        if (bot.currentWindow) {
          try { await bot.clickWindow(slotId, 0, 0); } catch(e) { console.log("leftClick err:", e.message); throw e; }
        } else {
          throw new Error("No UI is currently open");
        }
      },
      rightClick: async (slotId) => {
        if (bot.currentWindow) {
          try { await bot.clickWindow(slotId, 1, 0); } catch(e) { console.log("rightClick err:", e.message); throw e; }
        } else {
          throw new Error("No UI is currently open");
        }
      },
      shiftClick: async (slotId) => {
        if (bot.currentWindow) {
          try { await bot.clickWindow(slotId, 0, 1); } catch(e) { console.log("shiftClick err:", e.message); throw e; }
        } else {
          throw new Error("No UI is currently open");
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
      saveSpatialMemory: (topic, route, coords, screenshotFilename) => {
        try {
          const expPath = path.join(__dirname, 'task_tree.spatial_memory.json');
          let expData = { experiences: [] };
          if (fs.existsSync(expPath)) {
            expData = JSON.parse(fs.readFileSync(expPath, 'utf8'));
          }
          expData.experiences.push({ topic, route, coords, screenshotFilename, timestamp: new Date().toISOString() });
          fs.writeFileSync(expPath, JSON.stringify(expData, null, 2), 'utf8');
          console.log(`Spatial Memory saved: [${topic}]`);
        } catch(e) {
          console.log("Could not save spatial memory:", e.message);
        }
      },
      setEmergencyMode: (state, durationMs) => {
        if (aiUtils.setEmergencyMode) {
          aiUtils.setEmergencyMode(state, durationMs);
        } else {
          console.log("setEmergencyMode is not available in this context.");
        }
      }
    },
    vision: {
      takeScreenshot: async (filepath) => {
        if (aiUtils.captureSession && aiUtils.captureSession.takeHighResScreenshot) {
          try { await aiUtils.captureSession.takeHighResScreenshot(filepath); } catch(e) { console.log("Screenshot error:", e.message); }
        } else {
          console.log("takeScreenshot is not available in this context.");
        }
      }
    }
  };

  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      resourceLimits: { maxOldGenerationSizeMb: 50, maxYoungGenerationSizeMb: 10 }
    });

    worker.on('message', async (msg) => {
      if (msg.type === 'call') {
        try {
          let result;
          if (msg.target === 'mmskills') {
            let fn = mmskills;
            for (const p of msg.path) fn = fn[p];
            result = await fn(...msg.args);
          } else if (msg.target === 'bot') {
            if (msg.isProperty) {
              let val = bot;
              for (const p of msg.path) val = val[p];
              result = val;
            } else {
              let fn = bot;
              let parent = bot;
              for (let i = 0; i < msg.path.length; i++) {
                if (i === msg.path.length - 1) parent = fn;
                fn = fn[msg.path[i]];
              }
              result = await fn.apply(parent, msg.args);
            }
          } else if (msg.target === 'console') {
            if (msg.path[0] === 'log') console.log('[Worker Log]', ...msg.args);
            if (msg.path[0] === 'error') console.error('[Worker Error]', ...msg.args);
          }
          worker.postMessage({ type: 'response', id: msg.id, data: result });
        } catch (err) {
          worker.postMessage({ type: 'response', id: msg.id, error: err.message });
        }
      } else if (msg.type === 'done') {
        worker.terminate();
        resolve();
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.error));
      }
    });

    worker.on('error', (err) => {
      reject(new Error(`Worker exception: ${err.message}`));
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code} (possibly Memory Limit Exceeded)`));
      } else {
        resolve();
      }
    });

    worker.postMessage({ type: 'run', code: actualCode });
  });
}

module.exports = { executeSkillCode };
