const puppeteer = require('puppeteer');

async function startCapture(url) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480 });
  
  // Wait for viewer to load (allow some time for connection)
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (err) {
    console.warn("Viewer load timeout, continuing anyway...", err.message);
  }

  let frames = [];
  
  // Capture loop at 7fps (~142ms)
  // "86% quality reduced" means setting jpeg quality to 14
  const captureInterval = setInterval(async () => {
    try {
      if (page.isClosed()) return;
      const screenshot = await page.screenshot({ 
        type: 'jpeg', 
        quality: 14, 
        encoding: 'base64' 
      });
      frames.push(screenshot);
    } catch (e) {
      console.error('Capture error:', e);
    }
  }, Math.floor(1000 / 7));

  return {
    getAndClearFrames: () => {
      const currentFrames = frames;
      frames = [];
      return currentFrames;
    },
    takeHighResScreenshot: async (filepath) => {
      if (!page.isClosed()) {
        await page.screenshot({ path: filepath, type: 'jpeg', quality: 90 });
      }
    },
    stop: async () => {
      clearInterval(captureInterval);
      await browser.close();
    }
  };
}

module.exports = { startCapture };
