// SOLO (S on the desktop): show only the selected objects, S again to put every other object back
// as it was. For matching one mesh to another -- GNM's retopo sculpted onto a sculpt -- where the
// two overlap and each hides the other's errors. Hides as the outliner's eye does (the flag AND the
// three object), so the outliner and the renderer agree. Objects hidden before the solo stay hidden.
let _saved = null;   // [[mesh, wasVisible]] while soloed

export function isSoloed() { return !!_saved; }

export function toggleSolo(main) {
  const put = (m, on) => { m.setVisible(on); const tm = m.getThreeMesh?.(); if (tm) tm.visible = on; };
  if (_saved) {
    for (const [m, on] of _saved) if (main.getMeshes().includes(m)) put(m, on);
    _saved = null;
    window.screenLog?.('Solo off');
  } else {
    const keep = new Set(main.getSelectedMeshes?.() || [main.getMesh()].filter(Boolean));
    if (!keep.size) return window.screenLog?.('Select something to solo', 'yellow');
    _saved = main.getMeshes().filter((m) => !keep.has(m)).map((m) => [m, m.isVisible()]);
    for (const [m] of _saved) put(m, false);
    for (const m of keep) put(m, true);
    window.screenLog?.('Solo (S again to show the rest)');
  }
  window._updateOutlinerVisIcons?.();
  main.render();
}
