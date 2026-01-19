// server-phase2.js - Phase 2 Relay Server (FIXED TIMEOUT)
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "50mb" })); // Increased from 10mb

const DEFAULT_GOOGLE_SCRIPT = process.env.GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbyHaXWSmn8y1vGlCKI9xMx4jQi5R_zm_WXSwY6LRYJ3jq6WeeACpesf4pJp566npUmc8Q/exec";

// Health endpoint
app.get("/", (req, res) => {
  res.send("Phase 2 Relay Server alive. POST /upload with JSON { sheetName, values }");
});

// Main relay endpoint with LONGER TIMEOUT
app.post("/upload", async (req, res) => {
  try {
    const body = req.body;
    const scriptUrl = (body.googleScriptUrl && String(body.googleScriptUrl).trim()) || DEFAULT_GOOGLE_SCRIPT;
    
    if (!scriptUrl) {
      return res.status(400).json({ ok: false, error: "No script URL configured." });
    }

    if (!body.values || !Array.isArray(body.values)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid 'values' array in payload." });
    }
    
    const forward = {
      sheetName: body.sheetName || "PIF_Master",
      values: body.values
    };

    console.log(`[Relay] Uploading ${body.values.length} rows to ${body.sheetName || 'PIF_Master'}...`);

    // Try twice with LONGER TIMEOUT (120 seconds instead of 30)
    let tryCount = 0;
    let lastErr = null;
    
    while (tryCount < 2) {
      tryCount++;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds (was 15s)
        
        const r = await fetch(scriptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(forward),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (r.ok || r.status === 302) { 
          const text = await r.text().catch(() => "");
          console.log(`[Relay] Success! Status: ${r.status}`);
          return res.json({ ok: true, forwarded: true, status: r.status, text });
        } else {
          lastErr = `Non-OK response ${r.status}`;
          console.error(`[Relay] Attempt ${tryCount} failed: ${r.status}`);
          
          if (r.status >= 500 && tryCount < 2) {
            console.log('[Relay] Retrying in 1 second...');
            await new Promise(r => setTimeout(r, 1000));
            continue;
          } else {
            const text = await r.text().catch(() => "");
            return res.status(502).json({ 
              ok: false, 
              error: `Forward failed ${r.status}`, 
              status: r.status, 
              gasResponse: text 
            });
          }
        }
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          lastErr = 'Request timeout (120s)';
          console.error(`[Relay] Attempt ${tryCount} timed out after 120 seconds`);
        } else {
          lastErr = fetchError.message;
          console.error(`[Relay] Attempt ${tryCount} error:`, fetchError.message);
        }
        
        if (tryCount < 2) {
          console.log('[Relay] Retrying in 2 seconds...');
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
      }
    }
    
    return res.status(502).json({ 
      ok: false, 
      error: "Forward failed after retries", 
      details: lastErr 
    });
    
  } catch (err) {
    console.error("[Relay] Error:", err.message);
    return res.status(500).json({ 
      ok: false, 
      error: "Internal server error", 
      details: err.message 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Phase 2 Relay Server running on port ${PORT}`);
  console.log(`📊 Apps Script configured: ${!!DEFAULT_GOOGLE_SCRIPT}`);
});
