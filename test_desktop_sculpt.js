const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=swiftshader'] });
  const page = await browser.newPage();
  
  // Listen to console logs
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('http://127.0.0.1:8080', { waitUntil: 'networkidle2' });
  
  // Inject script to override SculptGL.prototype.onDeviceDown for debugging
  await page.evaluate(() => {
    if (window.app) {
      window.app._sculptManager.start = function(ctrl) {
        console.log("SculptManager.start called!");
        var tool = this.getCurrentTool();
        var canEdit = tool.start(ctrl);
        console.log("tool.start returned:", canEdit);
        return canEdit;
      };
      
      const origStart = window.app._sculptManager.getCurrentTool().start;
      window.app._sculptManager.getCurrentTool().start = function(ctrl) {
        console.log("SculptBase.start called!");
        var main = this._main;
        var picking = main.getPicking();
        var hit = picking.intersectionMouseMeshes();
        console.log("intersectionMouseMeshes returned:", hit);
        console.log("main._xrSession:", !!main._xrSession);
        console.log("main._vrMultiSelect:", !!main._vrMultiSelect);
        return origStart.call(this, ctrl);
      };
    }
  });

  console.log("Simulating click and drag...");
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(450, 300, { steps: 10 });
  await page.mouse.up();
  
  await browser.close();
})();
