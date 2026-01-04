import express from "express";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const app = express();

/* ================= BASIC CONFIG ================= */

const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.API_KEY || "").trim();

/* ================= HELPERS ================= */

function isNetscapeCookieFile(text) {
  const t = (text || "").trimStart();
  return t.startsWith("# Netscape HTTP Cookie File");
}

function cleanCookieHeader(text) {
  // for raw cookies like: "csrftoken=...; sessionid=..."
  const clean = (text || "").replace(/[\r\n]+/g, " ").trim();
  if (!clean || !clean.includes("=")) return "";
  return clean;
}

/* ================= HEALTH CHECK ================= */

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

/* ================= HOME ================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Stable IG Downloader API",
    usage: "/ig?url=INSTAGRAM_LINK&key=API_KEY"
  });
});

/* ================= MAIN API ================= */

app.get("/ig", (req, res) => {
  try {
    // 🔐 API key check
    const key = (req.query.key || "").toString().trim();
    if (!API_KEY || key !== API_KEY) {
      return res.status(403).json({ ok: false, error: "INVALID_API_KEY" });
    }

    const url = (req.query.url || "").toString().trim();
    if (!url) {
      return res.status(400).json({ ok: false, error: "MISSING_URL" });
    }

    const lower = url.toLowerCase();
    if (!lower.includes("instagram.com") && !lower.includes("instagr.am")) {
      return res.status(400).json({ ok: false, error: "NOT_INSTAGRAM" });
    }

    const args = ["--no-warnings", "--ignore-errors", "--no-playlist"];

    // Cookies (supports BOTH Netscape cookie file and raw cookie header)
    const cookies = (process.env.IG_COOKIES || "").trim();
    if (cookies) {
      if (isNetscapeCookieFile(cookies)) {
        const cookieFile = path.join(os.tmpdir(), `ig_cookies_${Date.now()}.txt`);
        fs.writeFileSync(cookieFile, cookies, "utf8");
        args.push("--cookies", cookieFile);
      } else {
        const cookieHeader = cleanCookieHeader(cookies);
        if (cookieHeader) {
          args.push("--add-header", `Cookie: ${cookieHeader}`);
        }
      }
    }

    // get direct links only
    args.push("-g", url);

    execFile("yt-dlp", args, { timeout: 45000 }, (err, stdout, stderr) => {
      if (err) {
        return res.json({
          ok: false,
          error: "DOWNLOAD_FAILED",
          reason: (stderr || err.message || "").toString().slice(0, 400)
        });
      }

      const links = (stdout || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);

      if (!links.length) {
        return res.json({ ok: false, error: "NO_MEDIA_FOUND" });
      }

      return res.json({
        ok: true,
        count: links.length,
        urls: links
      });
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      reason: (e?.message || "unknown").toString().slice(0, 200)
    });
  }
});

/* ================= START SERVER ================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Stable IG API running on port", PORT);
});
