// LINKS THAT OPEN THE APP SOMEWHERE: tokeru.com/sculptxr?lunk&face loads the Lunk example and
// selects the Face tool. Only BARE words count, so ?renderer=webgl and friends are never read here.
//
// A word is a tool if it matches an Enums.Tools key or the tool's label with the spaces taken out
// (face, bones, groups, delface). Otherwise it is an example if it starts the name of a file in
// examples.json (lunk, gnm, wrestler), so a new example needs no code here.
import Enums from './Enums.js';
import { TOOL_LABELS } from '../gui/htmlvr/toolLists.js';
import { fetchExamples, loadExampleInto } from '../gui/htmlvr/MainMenuPanel.js';

const toolFor = (word) => {
  for (const [key, id] of Object.entries(Enums.Tools)) {
    if (key.toLowerCase() === word || TOOL_LABELS[id]?.toLowerCase().replace(/\s/g, '') === word) return id;
  }
  return null;
};

// `addDefault` builds the usual startup scene. It runs when no example was asked for or the one
// asked for could not be loaded, so a bad link still leaves something to sculpt.
export function openStartupLink(main, addDefault) {
  const words = location.search.slice(1).split('&')
    .filter((w) => w && !w.includes('='))
    .map((w) => decodeURIComponent(w).toLowerCase());
  const tool = words.map(toolFor).find((id) => id !== null) ?? null;
  const rest = words.filter((w) => toolFor(w) === null);

  const selectTool = () => {
    if (tool === null) return;
    main.getSculptManager().setToolIndex(tool);
    try { main.getGui?.()._ctrlSculpting?._ctrlSculpt?.setValue(tool); } catch (_) {}
    main.render?.();
  };

  if (!rest.length) { addDefault(); selectTool(); return; }

  (async () => {
    const list = await fetchExamples();
    const i = list.findIndex((e) => rest.some((w) => e.file.toLowerCase().startsWith(w)));
    if (i < 0) console.warn('[link] no example or tool called', rest.join(', '));
    if (i < 0 || !(await loadExampleInto(main, i))) addDefault();
    selectTool();
  })();
}
