import express from "express";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const app = express();

/* ================= BASIC CONFIG ================= */

const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.API_KEY || "").trim();

// how long to keep merged files (ms)
const FILE_TTL_MS = Number(process.env.FILE_TTL_MS || `${15 * 60 * 1000}`); // 15 min

/* ================= HELPERS ================= */

function isNetscapeCookieFile(text) {
  const t = (text || "").trimStart();
  return t.startsWith("# Netscape HTTP Cookie File");
}

function cleanCookieHeader(text) {
  const clean = (text || "").replace(/[\r\n]+/g, " ").trim();
  if (!clean || !clean.includes("=")) return "";
  return clean;
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch {}
}

/* ================= HEALTH CHECK ================= */

app.get("/health", (req, res) => res.status(200).send("ok"));

/* ================= HOME ================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Stable IG Downloader API",
    usage: "/ig?url=INSTAGRAM_LINK&key=API_KEY",
    merged: "This API returns a single merged MP4 link hosted by this server"
  });
});

/* ================= DOWNLOAD ROUTE ================= */

app.get("/download/:name", (req, res) => {
  const filePath = path.join(os.tmpdir(), req.params.name);

  // basic path safety: only allow files in /tmp we created
  if (!filePath.startsWith(os.tmpdir())) {
    return res.status(400).send("bad request");
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "FILE_EXPIRED_OR_MISSING" });
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `inline; filename="${req.params.name}"`);
  fs.createReadStream(filePath).pipe(res);
});

/* ================= MAIN API (MERGED OUTPUT) ================= */

app.get("/ig", (req, res) => {
  try {
    const key = (req.query.key || "").toString().trim();
    if (!API_KEY || key !== API_KEY) {
      return res.status(403).json({ ok: false, error: "INVALID_API_KEY" });
    }

    const url = (req.query.url || "").toString().trim();
    if (!url) return res.status(400).json({ ok: false, error: "MISSING_URL" });

    const lower = url.toLowerCase();
    if (!lower.includes("instagram.com") && !lower.includes("instagr.am")) {
      return res.status(400).json({ ok: false, error: "NOT_INSTAGRAM" });
    }

    const cookies = (process.env.IG_COOKIES || "").trim();
    const args = [
      "--no-warnings",
      "--ignore-errors",
      "--no-playlist",
      // best video + best audio, fallback to best single
      "-f", "bv*+ba/b",
      "--merge-output-format", "mp4"
    ];

    // cookies support (Netscape OR raw cookie header)
    if (cookies) {
      if (isNetscapeCookieFile(cookies)) {
        const cookieFile = path.join(os.tmpdir(), `ig_cookies_${Date.now()}.txt`);
        fs.writeFileSync(cookieFile, cookies, "utf8");
        args.push("--cookies", cookieFile);
      } else {
        const cookieHeader = cleanCookieHeader(cookies);
        if (cookieHeader) args.push("--add-header", `Cookie: ${cookieHeader}`);
      }
    }

    // output file path
    const id = crypto.randomBytes(8).toString("hex");
    const outName = `ig_${id}.mp4`;
    const outPath = path.join(os.tmpdir(), outName);

    // tell yt-dlp where to save (force mp4 name)
    args.push("-o", outPath);

    // final target URL
    args.push(url);

    execFile("yt-dlp", args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        return res.json({
          ok: false,
          error: "DOWNLOAD_FAILED",
          reason: (stderr || err.message || "").toString().slice(0, 400)
        });
      }

      if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 50_000) {
        safeUnlink(outPath);
        return res.json({ ok: false, error: "MERGE_FAILED_OR_EMPTY" });
      }

      // auto-delete after TTL
      setTimeout(() => safeUnlink(outPath), FILE_TTL_MS).unref?.();

      // build download URL (Railway uses host header)
      const base = `${req.protocol}://${req.get("host")}`;
      return res.json({
        ok: true,
        merged: true,
        download: `${base}/download/${outName}`,
        expires_in_sec: Math.floor(FILE_TTL_MS / 1000)
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
