import fs from 'fs';
let code = fs.readFileSync('/Users/mattestela/.gemini/jetski/scratch/sculptxr/src/gui/GuiXR.js', 'utf8');

// Replace global assign
code = code.replace(
  "    if (now - this._inputDebounce < debounceTime) return;\n    this._inputDebounce = now;",
  "    if (now - this._inputDebounce < debounceTime) return;\n    // DO NOT SET DEBOUNCE GLOBALLY HERE. ONLY ON SUCCESSFUL ACTIONS."
);

// Inject into Tabs
code = code.replace(
  "if (idx >= 0 && idx < row1.length) this.switchTab(row1[idx]);",
  "if (idx >= 0 && idx < row1.length) { this._inputDebounce = now; this.switchTab(row1[idx]); }"
);
code = code.replace(
  "if (idx >= 0 && idx < row2.length) this.switchTab(row2[idx]);",
  "if (idx >= 0 && idx < row2.length) { this._inputDebounce = now; this.switchTab(row2[idx]); }"
);
code = code.replace(
  "if (idx >= 0 && idx < row3.length) this.switchTab(row3[idx]);",
  "if (idx >= 0 && idx < row3.length) { this._inputDebounce = now; this.switchTab(row3[idx]); }"
);

// Inject into Widgets
code = code.replace(
  "    // 4. Check Widgets\n    if (targetWid && isPressed && this._lastScrollY === undefined) {\n      if (this._hasClickedWidgetThisPress && targetWid.type !== \"slider\") return; // Prevent sweep-clicking multiple toggle buttons",
  "    // 4. Check Widgets\n    if (targetWid && isPressed && this._lastScrollY === undefined) {\n      if (this._hasClickedWidgetThisPress && targetWid.type !== \"slider\") return; // Prevent sweep-clicking multiple toggle buttons\n      this._inputDebounce = now; // SUCCESSFUL WIDGET HIT - APPLY DEBOUNCE"
);

fs.writeFileSync('/Users/mattestela/.gemini/jetski/scratch/sculptxr/src/gui/GuiXR.js.temp', code);
