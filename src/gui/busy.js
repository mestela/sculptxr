// BUSY BUTTONS: a button whose work runs in the background says so while it does (matt: "yes
// user, you pressed the button and it's doing work"). The label lives here, not on the element,
// so a panel rebuilt mid-job (VR panels rebuild often) draws it again, and the same button in
// the desktop sidebar and a VR panel both show it. A press while busy is ignored.
//
// runBusy(id, idle, text, job): job(progress) runs; progress(f) shows "text 40%". Templates call
// busyLabel(id, idle) for the button's text and busyAttr(id) for its class.
const busy = new Map();   // button id -> { idle, label }

export const isBusy = (id) => busy.has(id);
export const busyLabel = (id, idle) => busy.get(id)?.label ?? idle;
export const busyAttr = (id) => (busy.has(id) ? ' busy' : '');

function paint(id) {
  const b = busy.get(id);
  for (const el of document.querySelectorAll('#' + id)) {
    el.textContent = b ? b.label : el.dataset.idle ?? el.textContent;
    el.classList.toggle('busy', !!b);
  }
}

export async function runBusy(id, idle, text, job) {
  if (busy.has(id)) return;
  busy.set(id, { idle, label: text + '…' });
  for (const el of document.querySelectorAll('#' + id)) el.dataset.idle = idle;
  paint(id);
  let shown = -1;
  const progress = (f) => {
    const pc = Math.round(Math.min(1, Math.max(0, f)) * 100);
    if (pc === shown) return;
    shown = pc;
    busy.get(id).label = `${text} ${pc}%`;
    paint(id);
  };
  try {
    return await job(progress);
  } finally {
    busy.delete(id);
    for (const el of document.querySelectorAll('#' + id)) el.dataset.idle = idle;
    paint(id);
  }
}
