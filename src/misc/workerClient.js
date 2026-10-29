// A WORKER AS A PROMISE: post a job, get its answer. `onProgress(f)` hears the worker's
// { id, progress } messages on the way; a { id, error } reply rejects. One worker per client,
// started on first use, so a job that never runs costs nothing.
export function workerClient(Ctor) {
  let w = null, seq = 0;
  const jobs = new Map();
  return (msg, transfer = [], onProgress = null) => {
    if (!w) {
      w = new Ctor();
      w.onmessage = (e) => {
        const d = e.data, j = jobs.get(d.id);
        if (!j) return;
        if ('progress' in d) { j.onProgress?.(d.progress); return; }
        jobs.delete(d.id);
        if (d.error) j.reject(new Error(d.error)); else j.resolve(d);
      };
      // A crashed worker answers nothing: fail what it held and start a fresh one next time.
      w.onerror = (e) => {
        for (const j of jobs.values()) j.reject(new Error(e.message || 'worker failed'));
        jobs.clear();
        w.terminate(); w = null;
      };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => {
      jobs.set(id, { resolve, reject, onProgress });
      w.postMessage({ ...msg, id }, transfer);
    });
  };
}
