import Enums from './src/misc/Enums.js';
import Tools from './src/editing/tools/Tools.js';

var optTools = {};
for (var i = 0, nbTools = Tools.length; i < nbTools; ++i) {
  if (Tools[i]) {
    var TR = (k) => k || "TR_MISSING";
    optTools[TR(Tools[i].uiName)] = i;
  }
}
console.log(JSON.stringify(optTools, null, 2));
