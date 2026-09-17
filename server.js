const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const compression = require("compression");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = 3000;
const JWT_SECRET = "nova-secret-key-change-me";

const db = new Database("database.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    is_public INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    executions INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS keys (
    key TEXT PRIMARY KEY,
    script_id TEXT NOT NULL,
    user_label TEXT,
    roblox_id TEXT,
    banned INTEGER DEFAULT 0,
    key_type TEXT DEFAULT 'permanent',
    expires_at DATETIME,
    used_count INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS banned_users (
    roblox_id TEXT PRIMARY KEY,
    roblox_user TEXT,
    reason TEXT,
    banned_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT,
    script_id TEXT,
    script_name TEXT,
    roblox_user TEXT,
    roblox_id TEXT,
    place_id TEXT,
    avatar TEXT,
    ip TEXT,
    success INTEGER,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_logs_script ON logs(script_id);
  CREATE INDEX IF NOT EXISTS idx_keys_script ON keys(script_id);
`);

const ownerExists = db.prepare("SELECT * FROM users WHERE role = 'owner'").get();
if (!ownerExists) {
  const hash = bcrypt.hashSync("Jaimelepain80@@@", 10);
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run("owner", hash, "owner");
  console.log("[Nova] Owner cree : login = 'owner', password = 'Jaimelepain80@@@'");
}

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());
app.use(express.static("public", { maxAge: "1h" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync("scripts")) fs.mkdirSync("scripts");
      cb(null, "scripts/");
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"));
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Non authentifie" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

// ============ AUTH ============
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Champs manquants" });
  if (password.length < 4) return res.status(400).json({ error: "Mot de passe trop court" });
  if (username.length < 3) return res.status(400).json({ error: "Nom trop court" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const info = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'user')").run(username, hash);
    const token = jwt.sign({ id: info.lastInsertRowid, username, role: "user" }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie("token", token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ success: true, username, role: "user" });
  } catch (e) {
    if (e.message.includes("UNIQUE")) return res.status(400).json({ error: "Nom deja pris" });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Champs manquants" });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.status(401).json({ error: "Identifiants invalides" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Identifiants invalides" });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie("token", token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ success: true, username: user.username, role: user.role });
});

app.post("/api/logout", (req, res) => { res.clearCookie("token"); res.json({ success: true }); });
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// ============ SCRIPTS ============
app.post("/api/upload", requireAuth, upload.single("script"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier" });
  const { name, is_public, description } = req.body;
  if (!name) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: "Nom requis" }); }

  const scriptId = crypto.randomBytes(8).toString("hex");
  db.prepare("INSERT INTO scripts (id, user_id, name, filename, path, is_public, description) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(scriptId, req.user.id, name, req.file.originalname, req.file.path, is_public === "1" ? 1 : 0, description || "");
  res.json({ success: true, scriptId });
});

app.get("/api/scripts", requireAuth, (req, res) => {
  let scripts;
  if (req.user.role === "owner") {
    scripts = db.prepare(`
      SELECT s.*, u.username as owner_name,
        (SELECT COUNT(*) FROM keys WHERE script_id = s.id) as key_count,
        (SELECT COUNT(*) FROM logs WHERE script_id = s.id AND success = 1) as exec_count
      FROM scripts s JOIN users u ON s.user_id = u.id
      ORDER BY s.updated_at DESC
    `).all();
  } else {
    scripts = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM keys WHERE script_id = s.id) as key_count,
        (SELECT COUNT(*) FROM logs WHERE script_id = s.id AND success = 1) as exec_count
      FROM scripts s WHERE user_id = ?
      ORDER BY s.updated_at DESC
    `).all(req.user.id);
  }
  res.json(scripts);
});

app.put("/api/script/:id/public", requireAuth, (req, res) => {
  const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(req.params.id);
  if (!script) return res.status(404).json({ error: "Introuvable" });
  if (req.user.role !== "owner" && script.user_id !== req.user.id) return res.status(403).json({ error: "Refuse" });

  const { is_public } = req.body;
  db.prepare("UPDATE scripts SET is_public = ? WHERE id = ?").run(is_public ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.put("/api/script/:id/description", requireAuth, (req, res) => {
  const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(req.params.id);
  if (!script) return res.status(404).json({ error: "Introuvable" });
  if (req.user.role !== "owner" && script.user_id !== req.user.id) return res.status(403).json({ error: "Refuse" });

  db.prepare("UPDATE scripts SET description = ? WHERE id = ?").run(req.body.description || "", req.params.id);
  res.json({ success: true });
});

app.delete("/api/script/:id", requireAuth, (req, res) => {
  const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(req.params.id);
  if (!script) return res.status(404).json({ error: "Introuvable" });
  if (req.user.role !== "owner" && script.user_id !== req.user.id) return res.status(403).json({ error: "Refuse" });

  if (fs.existsSync(script.path)) fs.unlinkSync(script.path);
  db.prepare("DELETE FROM scripts WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM keys WHERE script_id = ?").run(req.params.id);
  res.json({ success: true });
});

// ============ KEYS ============
app.post("/api/key/generate", requireAuth, (req, res) => {
  const { scriptId, userLabel, keyType, expiresIn, maxUses } = req.body;
  if (!scriptId) return res.status(400).json({ error: "scriptId requis" });

  const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(scriptId);
  if (!script) return res.status(404).json({ error: "Script introuvable" });
  if (req.user.role !== "owner" && script.user_id !== req.user.id) return res.status(403).json({ error: "Refuse" });

  const rand = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  const key = `NOVA-${rand()}-${rand()}-${rand()}`;

  let expiresAt = null;
  if (keyType === "time" && expiresIn) {
    const hours = parseFloat(expiresIn);
    if (hours > 0) {
      const expDate = new Date(Date.now() + hours * 3600 * 1000);
      expiresAt = expDate.toISOString();
    }
  }

  const maxU = parseInt(maxUses) || 0;

  db.prepare(`
    INSERT INTO keys (key, script_id, user_label, key_type, expires_at, max_uses)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(key, scriptId, userLabel || "user", keyType || "permanent", expiresAt, maxU);

  res.json({ success: true, key, expires_at: expiresAt });
});

app.get("/api/keys/:scriptId", requireAuth, (req, res) => {
  const keys = db.prepare(`
    SELECT k.*,
      (SELECT COUNT(*) FROM logs WHERE key = k.key AND success = 1) as exec_count
    FROM keys k WHERE k.script_id = ?
    ORDER BY k.created_at DESC
  `).all(req.params.scriptId);
  res.json(keys);
});

app.delete("/api/key/:key", requireAuth, (req, res) => {
  db.prepare("DELETE FROM keys WHERE key = ?").run(req.params.key);
  res.json({ success: true });
});

app.put("/api/key/:key/ban", requireAuth, (req, res) => {
  const { banned } = req.body;
  db.prepare("UPDATE keys SET banned = ? WHERE key = ?").run(banned ? 1 : 0, req.params.key);
  res.json({ success: true });
});

app.put("/api/key/:key/expire", requireAuth, (req, res) => {
  const { expiresIn } = req.body;
  const hours = parseFloat(expiresIn);
  if (!hours || hours <= 0) return res.status(400).json({ error: "Duree invalide" });

  const expDate = new Date(Date.now() + hours * 3600 * 1000);
  db.prepare("UPDATE keys SET key_type = 'time', expires_at = ? WHERE key = ?").run(expDate.toISOString(), req.params.key);
  res.json({ success: true, expires_at: expDate.toISOString() });
});

// ============ BANNED USERS ============
app.post("/api/ban-user", requireAuth, (req, res) => {
  const { roblox_id, roblox_user, reason } = req.body;
  if (!roblox_id) return res.status(400).json({ error: "roblox_id requis" });

  db.prepare("INSERT OR REPLACE INTO banned_users (roblox_id, roblox_user, reason) VALUES (?, ?, ?)")
    .run(String(roblox_id), roblox_user || "", reason || "No reason");
  db.prepare("UPDATE keys SET banned = 1 WHERE roblox_id = ?").run(String(roblox_id));
  res.json({ success: true });
});

app.get("/api/banned-users", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM banned_users ORDER BY banned_at DESC").all());
});

app.delete("/api/ban-user/:roblox_id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM banned_users WHERE roblox_id = ?").run(req.params.roblox_id);
  res.json({ success: true });
});

// ============ VERIFY ============
app.get("/api/verify", (req, res) => {
  const { key, script_id, roblox_id, roblox_user, place_id } = req.query;
  const ip = req.ip || req.connection.remoteAddress;

  if (!key || !script_id) return res.json({ success: false, error: "Parametres manquants" });

  const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(script_id);
  const scriptName = script ? script.name : "unknown";

  const logFail = (reason) => {
    db.prepare("INSERT INTO logs (key, script_id, script_name, roblox_user, roblox_id, place_id, ip, success, reason) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)")
      .run(key, script_id, scriptName, roblox_user || null, roblox_id || null, place_id || null, ip, reason);
  };

  if (roblox_id) {
    const banned = db.prepare("SELECT * FROM banned_users WHERE roblox_id = ?").get(String(roblox_id));
    if (banned) {
      logFail("user_banned");
      return res.json({ success: false, error: "BANNED", banned: true, reason: banned.reason });
    }
  }

  const keyRow = db.prepare("SELECT * FROM keys WHERE key = ? AND script_id = ?").get(key, script_id);
  if (!keyRow) { logFail("invalid_key"); return res.json({ success: false, error: "Cle invalide" }); }
  if (keyRow.banned) { logFail("key_banned"); return res.json({ success: false, error: "Cle bannie" }); }

  // Verifie expiration
  if (keyRow.expires_at) {
    const expDate = new Date(keyRow.expires_at);
    if (expDate < new Date()) {
      logFail("expired");
      return res.json({ success: false, error: "Cle expiree", expired: true });
    }
  }

  // Verifie max uses
  if (keyRow.max_uses > 0 && keyRow.used_count >= keyRow.max_uses) {
    logFail("max_uses");
    return res.json({ success: false, error: "Limite d'utilisation atteinte" });
  }

  if (keyRow.roblox_id && String(keyRow.roblox_id) !== String(roblox_id)) {
    logFail("wrong_user");
    return res.json({ success: false, error: "Cle liee a un autre compte" });
  }

  if (!keyRow.roblox_id && roblox_id) {
    db.prepare("UPDATE keys SET roblox_id = ? WHERE key = ?").run(String(roblox_id), key);
  }

  // Incremente les utilisations
  db.prepare("UPDATE keys SET used_count = used_count + 1 WHERE key = ?").run(key);

  if (!script || !fs.existsSync(script.path)) { logFail("script_missing"); return res.json({ success: false, error: "Script introuvable" }); }

  db.prepare("UPDATE scripts SET executions = executions + 1 WHERE id = ?").run(script_id);

  let avatar = null;
  if (roblox_id) avatar = `https://www.roblox.com/headshot-thumbnail/image?userId=${roblox_id}&width=150&height=150&format=png`;

  db.prepare("INSERT INTO logs (key, script_id, script_name, roblox_user, roblox_id, place_id, avatar, ip, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)")
    .run(key, script_id, scriptName, roblox_user || null, roblox_id || null, place_id || null, avatar, ip);

  let expiresAt = keyRow.expires_at;
  let timeLeft = null;
  if (expiresAt) {
    timeLeft = Math.max(0, Math.floor((new Date(expiresAt) - new Date()) / 1000));
  }

  res.json({ success: true, script: fs.readFileSync(script.path, "utf-8"), script_name: script.name, expires_at: expiresAt, time_left: timeLeft });
});

// ============ LOGS ============
app.get("/api/logs", requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  let logs;
  if (req.user.role === "owner") {
    logs = db.prepare("SELECT * FROM logs ORDER BY created_at DESC LIMIT ?").all(limit);
  } else {
    const myScripts = db.prepare("SELECT id FROM scripts WHERE user_id = ?").all(req.user.id).map(s => s.id);
    if (myScripts.length === 0) return res.json([]);
    const placeholders = myScripts.map(() => "?").join(",");
    logs = db.prepare(`SELECT * FROM logs WHERE script_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`).all(...myScripts, limit);
  }
  res.json(logs);
});

// ============ STATS ============
app.get("/api/stats", requireAuth, (req, res) => {
  let scripts, keys, banned, logs, activeKeys;

  if (req.user.role === "owner") {
    scripts = db.prepare("SELECT COUNT(*) as c FROM scripts").get().c;
    keys = db.prepare("SELECT COUNT(*) as c FROM keys").get().c;
    banned = db.prepare("SELECT COUNT(*) as c FROM banned_users").get().c;
    logs = db.prepare("SELECT COUNT(*) as c FROM logs").get().c;
    activeKeys = db.prepare("SELECT COUNT(*) as c FROM keys WHERE banned = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))").get().c;
  } else {
    scripts = db.prepare("SELECT COUNT(*) as c FROM scripts WHERE user_id = ?").get(req.user.id).c;
    const myScripts = db.prepare("SELECT id FROM scripts WHERE user_id = ?").all(req.user.id).map(s => s.id);
    if (myScripts.length === 0) { keys = 0; logs = 0; activeKeys = 0; }
    else {
      const ph = myScripts.map(() => "?").join(",");
      keys = db.prepare(`SELECT COUNT(*) as c FROM keys WHERE script_id IN (${ph})`).get(...myScripts).c;
      logs = db.prepare(`SELECT COUNT(*) as c FROM logs WHERE script_id IN (${ph})`).get(...myScripts).c;
      activeKeys = db.prepare(`SELECT COUNT(*) as c FROM keys WHERE script_id IN (${ph}) AND banned = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))`).get(...myScripts).c;
    }
    banned = db.prepare("SELECT COUNT(*) as c FROM banned_users").get().c;
  }

  res.json({ scripts, keys, banned, logs, activeKeys });
});

// ============ PUBLIC SCRIPTS ============
app.get("/api/public-scripts", (req, res) => {
  const scripts = db.prepare(`
    SELECT s.id, s.name, s.description, s.executions, s.created_at, u.username as owner_name
    FROM scripts s JOIN users u ON s.user_id = u.id
    WHERE s.is_public = 1
    ORDER BY s.executions DESC, s.created_at DESC
    LIMIT 100
  `).all();
  res.json(scripts);
});

// ============ LOADER ============
app.get("/api/loader/:scriptId", (req, res) => {
  const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(req.params.scriptId);
  if (!script) return res.status(404).json({ error: "Introuvable" });

  const host = "https://" + req.get("host");
  const loader = `-- NOVA AUTH LOADER - ${script.name}
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local player = Players.LocalPlayer

local SERVER_URL = "${host}"
local SCRIPT_ID  = "${req.params.scriptId}"

local Skibidi = loadstring(game:HttpGet("https://raw.githubusercontent.com/Pjdojefoejhfuh/ad/refs/heads/main/zz"))()
Skibidi.SetTheme("gold")

local function httpGet(url)
    local ok, res = pcall(function() return game:HttpGet(url) end)
    if ok and res then return res end
    return nil
end

local function verifyKey(key)
    local url = string.format("%s/api/verify?key=%s&script_id=%s&roblox_id=%d&roblox_user=%s&place_id=%d",
        SERVER_URL, HttpService:UrlEncode(key), SCRIPT_ID, player.UserId,
        HttpService:UrlEncode(player.Name), game.PlaceId)
    local response = httpGet(url)
    if not response then return false, "Impossible de contacter le serveur" end
    local ok, data = pcall(function() return HttpService:JSONDecode(response) end)
    if not ok or not data then return false, "Reponse invalide" end
    if data.success then return true, data.script, data.time_left
    elseif data.banned then return false, "BANNED", data.reason
    elseif data.expired then return false, "EXPIRED"
    else return false, data.error or "Cle invalide" end
end

-- UI BANNED
local function showBannedUI(reason)
    local sg = Instance.new("ScreenGui")
    sg.Name = "BannedUI"
    sg.ResetOnSpawn = false
    sg.DisplayOrder = 2147483647
    sg.IgnoreGuiInset = true
    sg.Parent = player:WaitForChild("PlayerGui")

    local bg = Instance.new("Frame")
    bg.Size = UDim2.new(1, 0, 1, 0)
    bg.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
    bg.BackgroundTransparency = 0.1
    bg.BorderSizePixel = 0
    bg.Parent = sg

    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(0, 0, 0, 0)
    frame.Position = UDim2.new(0.5, 0, 0.5, 0)
    frame.BackgroundColor3 = Color3.fromRGB(8, 8, 8)
    frame.BorderSizePixel = 0
    frame.Parent = sg

    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 16)
    corner.Parent = frame

    local stroke = Instance.new("UIStroke")
    stroke.Color = Color3.fromRGB(255, 40, 40)
    stroke.Thickness = 3
    stroke.Parent = frame

    local grad = Instance.new("UIGradient")
    grad.Color = ColorSequence.new({
        ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 60, 60)),
        ColorSequenceKeypoint.new(0.5, Color3.fromRGB(120, 0, 0)),
        ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 60, 60))
    })
    grad.Rotation = 45
    grad.Parent = stroke

    task.spawn(function()
        while stroke.Parent do
            grad.Rotation = (grad.Rotation + 1.5) % 360
            task.wait(0.03)
        end
    end)

    local icon = Instance.new("TextLabel")
    icon.Size = UDim2.new(1, 0, 0, 60)
    icon.Position = UDim2.new(0, 0, 0, 20)
    icon.BackgroundTransparency = 1
    icon.Text = "&#128683;"
    icon.TextScaled = true
    icon.Font = Enum.Font.GothamBold
    icon.Parent = frame

    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, -20, 0, 70)
    title.Position = UDim2.new(0, 10, 0, 90)
    title.BackgroundTransparency = 1
    title.Text = "YOU GOT DEFINITELY BANNED"
    title.TextColor3 = Color3.fromRGB(255, 60, 60)
    title.Font = Enum.Font.GothamBlack
    title.TextScaled = true
    title.Parent = frame

    local sub = Instance.new("TextLabel")
    sub.Size = UDim2.new(1, -40, 0, 25)
    sub.Position = UDim2.new(0, 20, 0, 170)
    sub.BackgroundTransparency = 1
    sub.Text = "Reason: " .. tostring(reason or "Violation")
    sub.TextColor3 = Color3.fromRGB(220, 220, 220)
    sub.Font = Enum.Font.GothamBold
    sub.TextSize = 15
    sub.Parent = frame

    local info = Instance.new("TextLabel")
    info.Size = UDim2.new(1, -40, 0, 60)
    info.Position = UDim2.new(0, 20, 0, 200)
    info.BackgroundTransparency = 1
    info.Text = "Your Roblox account has been permanently banned from using this script.\\nContact the administrator if you think this is a mistake."
    info.TextColor3 = Color3.fromRGB(140, 140, 140)
    info.Font = Enum.Font.Gotham
    info.TextSize = 12
    info.TextWrapped = true
    info.Parent = frame

    local bar = Instance.new("Frame")
    bar.Size = UDim2.new(1, -40, 0, 4)
    bar.Position = UDim2.new(0, 20, 1, -20)
    bar.BackgroundColor3 = Color3.fromRGB(255, 40, 40)
    bar.BorderSizePixel = 0
    bar.Parent = frame

    local barCorner = Instance.new("UICorner")
    barCorner.CornerRadius = UDim.new(1, 0)
    barCorner.Parent = bar

    task.spawn(function()
        while frame.Parent do
            for i = 0, 1, 0.05 do
                if not frame.Parent then return end
                stroke.Transparency = i * 0.5
                task.wait(0.02)
            end
            for i = 1, 0, -0.05 do
                if not frame.Parent then return end
                stroke.Transparency = i * 0.5
                task.wait(0.02)
            end
        end
    end)

    game:GetService("TweenService"):Create(frame,
        TweenInfo.new(0.6, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
        { Size = UDim2.new(0, 540, 0, 300), Position = UDim2.new(0.5, -270, 0.5, -150) }):Play()
end

-- UI EXPIRED
local function showExpiredUI()
    local sg = Instance.new("ScreenGui")
    sg.Name = "ExpiredUI"
    sg.ResetOnSpawn = false
    sg.DisplayOrder = 2147483647
    sg.IgnoreGuiInset = true
    sg.Parent = player:WaitForChild("PlayerGui")

    local bg = Instance.new("Frame")
    bg.Size = UDim2.new(1, 0, 1, 0)
    bg.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
    bg.BackgroundTransparency = 0.1
    bg.BorderSizePixel = 0
    bg.Parent = sg

    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(0, 0, 0, 0)
    frame.Position = UDim2.new(0.5, 0, 0.5, 0)
    frame.BackgroundColor3 = Color3.fromRGB(8, 8, 8)
    frame.BorderSizePixel = 0
    frame.Parent = sg

    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 16)
    corner.Parent = frame

    local stroke = Instance.new("UIStroke")
    stroke.Color = Color3.fromRGB(255, 180, 40)
    stroke.Thickness = 3
    stroke.Parent = frame

    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, -20, 0, 70)
    title.Position = UDim2.new(0, 10, 0, 40)
    title.BackgroundTransparency = 1
    title.Text = "KEY EXPIRED"
    title.TextColor3 = Color3.fromRGB(255, 180, 40)
    title.Font = Enum.Font.GothamBlack
    title.TextScaled = true
    title.Parent = frame

    local sub = Instance.new("TextLabel")
    sub.Size = UDim2.new(1, -40, 0, 60)
    sub.Position = UDim2.new(0, 20, 0, 130)
    sub.BackgroundTransparency = 1
    sub.Text = "Your license key has expired.\\nContact the administrator to renew it."
    sub.TextColor3 = Color3.fromRGB(200, 200, 200)
    sub.Font = Enum.Font.Gotham
    sub.TextSize = 13
    sub.TextWrapped = true
    sub.Parent = frame

    game:GetService("TweenService"):Create(frame,
        TweenInfo.new(0.6, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
        { Size = UDim2.new(0, 480, 0, 240), Position = UDim2.new(0.5, -240, 0.5, -120) }):Play()
end

local licensePanel = nil
local scriptStarted = false

local function showKeyPrompt()
    if licensePanel or scriptStarted then return end

    licensePanel = Skibidi.CreatePanel({
        Name = "NovaLicense", Title = "NOVA SNIPER", SubTitle = "key system",
        Icon = "key", Width = 400, Height = 340,
        Search = false, Scaler = false, ConfirmClose = false,
    })

    task.defer(function()
        if licensePanel and licensePanel.Gui then
            licensePanel.Gui.DisplayOrder = 2147483647
        end
    end)

    local content = licensePanel.Content
    if not content then return end

    Skibidi.CreateSection(content, { Title = "Enter your key", Open = true })

    local statusLbl = Skibidi.CreateLabel(content, {
        Text = "Locked", Color = Color3.fromRGB(255, 200, 90), Height = 22,
    })

    Skibidi.CreateLabel(content, {
        Text = "Logged in as " .. player.DisplayName,
        Color = Color3.fromRGB(160, 150, 175), Height = 16,
    })

    local keyInput = Skibidi.CreateTextInput(content, {
        Label = "License Key", Placeholder = "NOVA-XXXX-XXXX-XXXX",
        Icon = "key", Width = 240,
    })

    Skibidi.CreateButton(content, {
        Text = "UNLOCK", Icon = "unlock",
        Color = Color3.fromRGB(220, 160, 60), TextColor = Color3.fromRGB(12, 12, 12),
        OnClick = function()
            local input = keyInput and keyInput.GetValue() or ""
            input = input:gsub("%s+", "")
            if input == "" then statusLbl.SetText("Cle vide"); return end
            statusLbl.SetText("Verification...")
            task.spawn(function()
                local valid, result, timeLeft = verifyKey(input)
                if valid then
                    statusLbl.SetText("Acces autorise")
                    Skibidi.ShowNotification("License", "Acces autorise !", 3, "success")
                    task.delay(0.6, function()
                        if licensePanel and licensePanel.Gui then licensePanel.Gui:Destroy() end
                        licensePanel = nil
                        scriptStarted = true
                        task.spawn(function()
                            local ok, err = pcall(function() loadstring(result)() end)
                            if not ok then
                                warn("[Nova] Loading failed:", err)
                                scriptStarted = false
                                task.wait(1)
                                showKeyPrompt()
                            end
                        end)
                    end)
                elseif result == "BANNED" then
                    if licensePanel and licensePanel.Gui then licensePanel.Gui:Destroy() end
                    licensePanel = nil
                    showBannedUI(timeLeft)
                elseif result == "EXPIRED" then
                    if licensePanel and licensePanel.Gui then licensePanel.Gui:Destroy() end
                    licensePanel = nil
                    showExpiredUI()
                else
                    statusLbl.SetText(result or "Cle invalide")
                    Skibidi.ShowNotification("License", result or "Cle invalide", 3, "error")
                end
            end)
        end,
    })

    local SITE_URL = SERVER_URL .. "/script/" .. SCRIPT_ID

    Skibidi.CreateButton(content, {
        Text = "Copy Link", Icon = "copy",
        Color = Color3.fromRGB(80, 80, 80), TextColor = Color3.fromRGB(255, 255, 255),
        OnClick = function()
            pcall(function() if setclipboard then setclipboard(SITE_URL) end end)
            Skibidi.ShowNotification("Link", "Lien copie : " .. SITE_URL, 4, "success")
        end,
    })
end

showKeyPrompt()
`;

  res.type("text/plain").send(loader);
});

app.get("/script/:scriptId", (req, res) => {
  const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(req.params.scriptId);
  if (!script) return res.status(404).send("Script introuvable");
  res.sendFile(path.join(__dirname, "public", "script.html"));
});

app.get("/api/script-info/:scriptId", (req, res) => {
  const script = db.prepare(`
    SELECT s.id, s.name, s.description, s.is_public, s.executions, s.created_at, u.username as owner_name
    FROM scripts s JOIN users u ON s.user_id = u.id
    WHERE s.id = ?
  `).get(req.params.scriptId);
  if (!script) return res.status(404).json({ error: "Introuvable" });
  res.json(script);
});

app.listen(PORT, () => {
  console.log("");
  console.log("========================================");
  console.log("   NOVA AUTH v4");
  console.log("========================================");
  console.log("Site     : http://localhost:" + PORT);
  console.log("Owner    : username = owner");
  console.log("Password : Jaimelepain80@@@");
  console.log("");
});
