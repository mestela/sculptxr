export default class StorageDB {
  static open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SculptXR_Workspace', 1);
      
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets'); // Key-value store for meshes/textures
        }
      };

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  static get(key) {
    return this.open().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('assets', 'readonly');
        const store = tx.objectStore('assets');
        const req = store.get(key);

        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
      });
    });
  }

  static set(key, val) {
    return this.open().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('assets', 'readwrite');
        const store = tx.objectStore('assets');
        const req = store.put(val, key);

        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      });
    });
  }

  static delete(key) {
    return this.open().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('assets', 'readwrite');
        const store = tx.objectStore('assets');
        const req = store.delete(key);

        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      });
    });
  }

  static getAll() {
    return this.open().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('assets', 'readonly');
        const store = tx.objectStore('assets');
        const req = store.getAll(); // Get all values
        const keysReq = store.getAllKeys(); // Get all keys

        req.onsuccess = () => {
          keysReq.onsuccess = () => {
            const results = keysReq.result.map((key, i) => ({
              key,
              value: req.result[i]
            }));
            resolve(results);
          };
        };
        req.onerror = (e) => reject(e.target.error);
      });
    });
  }
}
