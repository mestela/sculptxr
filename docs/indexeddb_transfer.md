# IndexedDB Direct Binary Transfer Protocol

Because IndexedDB data respects the **Same-Origin Policy**, databases created on your local development environment (`localhost`) are strictly isolated from `tokeru.com/sculptxrbeta`. 

When dealing with large multi-megabyte meshes, converting binary arrays (`ArrayBuffer`) to strings via `JSON.stringify` or `Base64` inflates the size by ~33% and can crash the DevTools string buffer.

Below is a copy-pasteable protocol to read and write the raw binary buffers directly using **Blobs** and **FileReaders** with exactly zero bytes of string overhead.

---

## 1. Direct Binary Export (from Localhost)

Open the DevTools Console (`F12`) on your local `localhost` view and run the following script to download your binary model exactly as it is stored on disk:

```javascript
const request = indexedDB.open("SculptXR_DB");
request.onsuccess = (e) => {
  const db = e.target.result;
  const tx = db.transaction("sculpts", "readonly");
  
  // Get the specific sculpt or the first item:
  tx.objectStore("sculpts").getAll().onsuccess = (res) => {
    const items = res.target.result;
    if (items.length === 0) return console.warn("No models found!");
    
    // Grab the raw ArrayBuffer of the target model
    const rawBuffer = items[0].data;
    
    // Save precisely as raw Octet-Stream bytes
    const blob = new Blob([rawBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = items[0].id + "_raw_backup.bin";
    a.click();
  };
};
```

---

## 2. Direct Binary Import (into Beta Site)

Open the DevTools Console (`F12`) on `tokeru.com/sculptxrbeta` and run this snippet. It creates a temporary file selector. Select the `.bin` file you downloaded above, and it will restore the exact raw `ArrayBuffer` into the site's IndexedDB:

```javascript
const input = document.createElement("input");
input.type = "file";
input.onchange = (e) => {
  const file = e.target.files[0];
  const reader = new FileReader();
  
  // Crucial: Read as ArrayBuffer, not Text
  reader.readAsArrayBuffer(file);
  
  reader.onload = (event) => {
    const rawBinary = event.target.result;
    
    const request = indexedDB.open("SculptXR_DB");
    request.onsuccess = (evt) => {
      const db = evt.target.result;
      const tx = db.transaction("sculpts", "readwrite");
      
      tx.objectStore("sculpts").put({
        id: file.name.replace("_raw_backup.bin", ""),
        data: rawBinary
      });
      
      console.log("Binary Import successful! Refresh to access the model.");
    };
  };
};
document.body.prepend(input);
```
