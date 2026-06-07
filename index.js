require('dotenv').config();
const mineflayer = require('mineflayer');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { startCapture } = require('./vision/capture');
const { startAgentLoop, recordSoundEvent, recordChatEvent } = require('./ai/lowLevelAgent');

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT || '25565', 10),
  username: process.env.MC_USERNAME || 'MineMate'
});

bot.once('spawn', () => {
  console.log('Bot spawned. Setting up viewer...');
  mineflayerViewer(bot, { port: 3000, firstPerson: true });
  
  console.log('Starting vision capture...');
  startCapture('http://localhost:3000').then((captureSession) => {
    console.log('Vision capture started. Starting agent loop...');
    startAgentLoop(bot, captureSession);
  }).catch(err => {
    console.error('Failed to start vision capture:', err);
  });
});

bot.on('chat', (username, message) => {
  if (username === bot.username) return;
  console.log(`<${username}> ${message}`);
  recordChatEvent(username, message);
});

bot.on('soundEffectHeard', (soundName, soundCategory, position, volume, pitch) => {
  recordSoundEvent(bot, soundName, soundCategory, position, volume, pitch);
});

bot.on('error', err => console.log('Bot error:', err));
bot.on('kicked', reason => console.log('Bot kicked:', reason));
