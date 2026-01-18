// server-phase2.js - Relay server for PIF Phase 2 data
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "50mb" })); // Increased for Rating Justification text

// Your NEW Apps Script URL (set as environment variable on Render)
const PHASE2_GOOGLE_SCRIPT = process.env.PHASE2_GOOGLE_SCRIPT_URL || "";

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "alive",
    service: "PIF Phase 2 Relay",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    configured: !!PHASE2_GOOGLE_SCRIPT
  });
});

// Upload endpoint
app.post("/upload", async (req, res) => {
  try {
    console.log("[Phase2 Relay] Received upload request");
    
    const body = req.body;
    
    // Get script URL (allow override from request)
    const scriptUrl = (body.googleScriptUrl && String(body.googleScriptUrl).trim()) || PHASE2_GOOGLE_SCRIPT;
    
    if (!scriptUrl) {
      console.error("[Phase2 Relay] No Google Script URL configured");
      return res.status(400).json({ 
        ok: false, 
        error: "No script URL configured. Set PHASE2_GOOGLE_SCRIPT_URL environment variable." 
      });
    }

    // Validate payload
    if (!body.values || !Array.isArray(body.values)) {
      console.error("[Phase2 Relay] Invalid payload - missing values array");
      return res.status(400).json({ 
        ok: false, 
        error: "Missing or invalid 'values' array in payload." 
      });
    }
    
    console.log(`[Phase2 Relay] Forwarding ${body.values.length} rows to Apps Script`);
    
    // Log sample data (first row only, truncate Rating Justification)
    if (body.values.length > 0) {
      const sampleRow = body.values[0].slice(0, 10);
      console.log(`[Phase2 Relay] Sample row:`, sampleRow);
    }
    
    // Prepare payload for Apps Script
    const forward = {
      sheetName: body.sheetName || "PIF_Master",
      values: body.values
    };

    // Forward to Google Apps Script with retries
    let tryCount = 0;
    let lastErr = null;
    
    while (tryCount < 2) {
      tryCount++;
      
      try {
        console.log(`[Phase2 Relay] Attempt ${tryCount}: Sending to Apps Script...`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
        
        const r = await fetch(scriptUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(forward),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Apps Script returns 302 redirect on success
        if (r.ok || r.status === 302) {
          const text = await r.text().catch(() => "");
          console.log(`[Phase2 Relay] ✅ Success! Status: ${r.status}`);
          
          return res.json({ 
            ok: true, 
            forwarded: true, 
            status: r.status, 
            rowsForwarded: body.values.length,
            response: text
          });
        } else {
          lastErr = `Apps Script returned ${r.status}`;
          console.error(`[Phase2 Relay] Apps Script error: ${r.status}`);
          
          // If 5xx error, retry
          if (r.status >= 500 && tryCount < 2) {
            console.log(`[Phase2 Relay] Retrying in 2 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          } else {
            const text = await r.text().catch(() => "");
            return res.status(502).json({ 
              ok: false, 
              error: `Apps Script failed: ${r.status}`, 
              status: r.status, 
              gasResponse: text 
            });
          }
        }
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          lastErr = 'Request timeout (30s)';
          console.error(`[Phase2 Relay] Timeout on attempt ${tryCount}`);
        } else {
          lastErr = fetchError.message;
          console.error(`[Phase2 Relay] Fetch error:`, fetchError.message);
        }
        
        // Retry on network errors
        if (tryCount < 2) {
          console.log(`[Phase2 Relay] Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
    }
    
    // All retries failed
    console.error(`[Phase2 Relay] ❌ All attempts failed: ${lastErr}`);
    return res.status(502).json({ 
      ok: false, 
      error: "Forward failed after retries", 
      details: lastErr 
    });
    
  } catch (error) {
    console.error("[Phase2 Relay] Server error:", error.message);
    return res.status(500).json({ 
      ok: false, 
      error: "Internal server error", 
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Phase 2 Relay Server running on port ${PORT}`);
  console.log(`📊 Apps Script configured: ${!!PHASE2_GOOGLE_SCRIPT}`);
});
