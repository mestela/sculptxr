import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * A CONSOLE AND AN EVAL CHANNEL FOR DEVICES THAT HAVE NEITHER.
 *
 * The GalaxyXR gives a full Chrome DevTools Protocol over `adb forward`, which is what made
 * tonight's work possible: read the console, run an expression, read the answer. iPadOS and
 * visionOS give nothing comparable -- ios_webkit_debug_proxy lists the page on iOS 26 and then
 * refuses every protocol domain ('Runtime' domain was not found), and Safari's Web Inspector is
 * a GUI a human has to drive. Ten round trips of matt copy-pasting expressions into a headset
 * is what this replaces.
 *
 * DEV SERVER ONLY, by construction rather than by a flag: `apply: 'serve'` means it is not in
 * the plugin list for a build at all, and the client half sits behind import.meta.env.DEV, so
 * neither half can reach production.
 */
export default function devRelay(dir = '.devrelay') {
  const root = resolve(process.cwd(), dir);
  const cmdFile = resolve(root, 'cmd.json');
  const resFile = resolve(root, 'result.jsonl');
  const read = (req) => new Promise((ok) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b));
  });

  return {
    name: 'sculptxr-dev-relay',
    apply: 'serve',
    configureServer(server) {
      mkdirSync(root, { recursive: true });
      server.middlewares.use('/__relay/log', async (req, res) => {
        try {
          const { device, lines } = JSON.parse(await read(req));
          const safe = String(device || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
          appendFileSync(resolve(root, safe + '.log'), lines.join('\n') + '\n');
        } catch (e) { /* a relay never breaks the page it is watching */ }
        res.statusCode = 204; res.end();
      });
      // ONE-SHOT, BROADCAST. Every connected device runs the pending expression and labels its
      // own answer, which is the behaviour you want when the question is "do these two devices
      // disagree" -- and that has been the question all evening.
      server.middlewares.use('/__relay/cmd', async (req, res) => {
        if (req.method === 'POST') {
          try { appendFileSync(resFile, (await read(req)).trim() + '\n'); } catch (e) {}
          res.statusCode = 204; return res.end();
        }
        if (!existsSync(cmdFile)) { res.statusCode = 204; return res.end(); }
        res.setHeader('content-type', 'application/json');
        res.end(readFileSync(cmdFile, 'utf8'));
      });
    }
  };
}
