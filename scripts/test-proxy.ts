import WebSocket from "ws";

async function testBirdeye() {
  console.log("\\n--- Testing Birdeye Proxy ---");
  try {
    const res = await fetch(
      "http://localhost:5555/api/proxy/birdeye/price?address=So11111111111111111111111111111111111111112",
    );
    console.log("Birdeye Status:", res.status);
    console.log("Birdeye Response:", await res.json());
  } catch (err) {
    console.error("Birdeye Error:", err);
  }
}

async function testHeliusRpc() {
  console.log("\\n--- Testing Helius RPC Proxy ---");
  try {
    const res = await fetch("http://localhost:5555/api/proxy/helius/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      }),
    });
    console.log("Helius RPC Status:", res.status);
    console.log("Helius RPC Response:", await res.json());
  } catch (err) {
    console.error("Helius RPC Error:", err);
  }
}

async function testHeliusWs() {
  console.log("\\n--- Testing Helius WS Proxy ---");
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://localhost:5555/api/proxy/helius/ws");

    // Timeout in case WS hangs
    const timeout = setTimeout(() => {
      console.log("Helius WS Message: Timed out waiting for response");
      ws.close();
      resolve(null);
    }, 5000);

    ws.on("open", () => {
      console.log("Helius WS Connected");
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "slotSubscribe",
        }),
      );
    });

    ws.on("message", (data: any) => {
      console.log("Helius WS Message:", data.toString());
      clearTimeout(timeout);
      ws.close();
      resolve(null);
    });

    ws.on("error", (err: any) => {
      console.error("Helius WS Error:", err);
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

async function main() {
  await testBirdeye();
  await testHeliusRpc();
  await testHeliusWs();
  process.exit(0);
}

main().catch(console.error);
