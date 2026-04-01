// Empty first line


async function main() {
    const targetIp = "localhost";
    const targetPort = "9223";

    while (true) {
        console.log(`[Jetski Logger] Fetching active tabs from http://${targetIp}:${targetPort}/json...`);

        try {
            const response = await fetch(`http://${targetIp}:${targetPort}/json`);
            const tabs = await response.json();
            
            // Find check any valid tab (not-devtools)
            const sculptTab = tabs.find(t => t.url && !t.url.startsWith("devtools://") && !t.url.startsWith("chrome-extension://"));
            
            if (!sculptTab) {
                console.log("[Jetski Logger] Could not find any valid web tab! Retrying in 2 seconds...");
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const wsUrl = sculptTab.webSocketDebuggerUrl;
            console.log(`[Jetski Logger] Connecting to WebSocket: ${wsUrl}`);

            const ws = new WebSocket(wsUrl);

            await new Promise((resolve, reject) => {
                ws.onopen = () => {
                    console.log("[Jetski Logger] WebSocket connected! Enabling Runtime...");
                    ws.send(JSON.stringify({
                        id: 1,
                        method: "Runtime.enable"
                    }));
                    ws.send(JSON.stringify({
                        id: 2,
                        method: "Log.enable"
                    }));
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        
                        if (data.method === "Runtime.consoleAPICalled") {
                            const args = data.params.args;
                            const type = data.params.type;
                            const text = args.map(arg => {
                                if (arg.value !== undefined) return arg.value;
                                if (arg.description) return arg.description;
                                return JSON.stringify(arg);
                            }).join(" ");
                            
                            console.log(`[Console ${type}] ${text}`);
                        } else if (data.method === "Log.entryAdded") {
                            console.log(`[Log ${data.params.entry.level}] ${data.params.entry.text}`);
                        }
                    } catch (err) {
                        // ignore noise
                    }
                };

                ws.onclose = () => {
                    console.log("[Jetski Logger] WebSocket connection closed. Reconnecting in 2 seconds...");
                    resolve(); // Allows loop to continue
                };

                ws.onerror = (err) => {
                    console.error("[Jetski Logger] WebSocket error:", err);
                    ws.close(); // Ensure standard onclose is triggered
                    reject(err);
                };
            }).catch(err => {
                console.log("[Jetski Logger] Connection failed or errored. Retrying in 2 seconds...");
            });

            await new Promise(r => setTimeout(r, 2000)); // Delay between reconnects

        } catch (err) {
            console.error("[Jetski Logger] Error connecting to Chrome Debugger:", err);
            await new Promise(r => setTimeout(r, 2000)); // Delay between retries
        }
    }
}

main();
