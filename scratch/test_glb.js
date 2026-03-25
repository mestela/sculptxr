import https from 'https';

const url = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/samsung-galaxyxr/left.glb';

https.get(url, (res) => {
  console.log(`Status: ${res.statusCode}`);
  const len = res.headers['content-length'];
  console.log(`Length: ${len}`);
  res.resume(); // consume response data to free up memory
}).on('error', (e) => {
  console.error(`Error: ${e.message}`);
});
