require("dotenv").config();
const https = require("https");

const USER_TOKEN = process.env.TOKEN;
const BUMP_CHANNEL_ID = process.env.BUMP_CHANNEL_ID;

const DISBOARD_BOT_ID = "302050872383242240";
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000; 
const DISCORD_API = "discord.com";

let lastBumpTime = 0;
let bumpTimer = null;

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: DISCORD_API,
      path: `/api/v10${path}`,
      method,
      headers: {
        Authorization: USER_TOKEN,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getChannel() {
  const res = await apiRequest("GET", `/channels/${BUMP_CHANNEL_ID}`);
  if (res.status !== 200) throw new Error(`Channel fetch failed: ${res.status}`);
  return res.body;
}

async function getBumpCommand(guildId) {
  const res = await apiRequest(
    "GET",
    `/guilds/${guildId}/application-command-index`
  );
  if (res.status !== 200) throw new Error(`Command fetch failed: ${res.status}`);

  const commands = res.body?.application_commands ?? [];
  console.log(`[Auto-Bump] ${commands.length} commande(s) trouvée(s) sur le serveur.`);

  const match = commands.find(
    (cmd) => cmd.name === "bump" && cmd.application_id === DISBOARD_BOT_ID
  );

  if (!match) {
    const names = commands.map((c) => `${c.name} (app:${c.application_id})`).join(", ");
    console.warn(`[Auto-Bump] Commandes disponibles : ${names || "aucune"}`); 
  }

  return match;
}

async function sendBumpInteraction(guildId, bumpCommand) {
  const nonce = String(Date.now());
  const body = {
    type: 2,
    application_id: DISBOARD_BOT_ID,
    guild_id: guildId,
    channel_id: BUMP_CHANNEL_ID,
    session_id: nonce,
    data: {
      version: bumpCommand.version,
      id: bumpCommand.id,
      name: "bump",
      type: 1,
      application_command: bumpCommand,
      options: [],
      attachments: [],
    },
    nonce,
    analytics_location: "slash_ui",
  };

  const res = await apiRequest("POST", "/interactions", body);
  return res.status === 204 || res.status === 200;
}

const WebSocket = require("ws");
let ws = null;
let heartbeatInterval = null;
let sessionId = null;
let sequence = null;

function connectGateway() {
  ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");

  ws.on("open", () => console.log("[Gateway] Connecté au gateway Discord."));

  ws.on("message", async (data) => {
    const payload = JSON.parse(data);
    const { op, t, s, d } = payload;

    if (s) sequence = s;

    if (op === 10) {
      const interval = d.heartbeat_interval;
      heartbeatInterval = setInterval(() => {
        ws.send(JSON.stringify({ op: 1, d: sequence }));
      }, interval);

      ws.send(
        JSON.stringify({
          op: 2,
          d: {
            token: USER_TOKEN,
            properties: { os: "windows", browser: "chrome", device: "" },
            intents: (1 << 0) | (1 << 9) | (1 << 12), // GUILDS, GUILD_MESSAGES, MESSAGE_CONTENT
          },
        })
      );
    }

    if (op === 0) {
      if (t === "READY") {
        console.log(`[Auto-Bump] Connecté en tant que ${d.user.username}#${d.user.discriminator}`);
        sessionId = d.session_id;
        scheduleBump(0); 
      }

      if (t === "MESSAGE_CREATE") {
        if (
          d.author?.id === DISBOARD_BOT_ID &&
          d.channel_id === BUMP_CHANNEL_ID
        ) {
          const desc = d.embeds?.[0]?.description ?? "";
          if (desc.toLowerCase().includes("bump") || desc.includes(":thumbsup:")) {
            console.log(`[Auto-Bump]  Bump confirmé par Disboard. Prochain bump dans 2h.`);
            lastBumpTime = Date.now();
            clearTimeout(bumpTimer);
            scheduleBump(BUMP_COOLDOWN_MS);
          }
        }
      }
    }

    if (op === 7) reconnectGateway();

    if (op === 9) {
      console.warn("[Gateway] Session invalide. Reconnexion...");
      setTimeout(connectGateway, 5000);
    }
  });

  ws.on("close", () => {
    clearInterval(heartbeatInterval);
    console.warn("[Gateway] Déconnecté. Reconnexion dans 5s...");
    setTimeout(connectGateway, 5000);
  });

  ws.on("error", (err) => console.error("[Gateway] Erreur :", err.message));
}

function reconnectGateway() {
  clearInterval(heartbeatInterval);
  ws?.terminate();
  setTimeout(connectGateway, 1000);
}

async function bump() {
  try {
    console.log(`[Auto-Bump] Tentative de bump... (${new Date().toLocaleString("fr-FR")})`);

    const channel = await getChannel();
    const guildId = channel.guild_id;

    const bumpCommand = await getBumpCommand(guildId);
    if (!bumpCommand) {
      console.error("[Auto-Bump] ❌ Commande /bump introuvable. Disboard est-il sur le serveur ?");
      scheduleBump(BUMP_COOLDOWN_MS);
      return;
    }

    const ok = await sendBumpInteraction(guildId, bumpCommand);
    if (ok) {
      console.log(`[Auto-Bump]  /bump envoyé avec succès.`);
      lastBumpTime = Date.now();
      scheduleBump(BUMP_COOLDOWN_MS);
    } else {
      console.error("[Auto-Bump]  Échec de l'envoi du bump. Retry dans 5 min.");
      scheduleBump(5 * 60 * 1000);
    }
  } catch (err) {
    console.error("[Auto-Bump] Erreur :", err.message);
    scheduleBump(5 * 60 * 1000);
  }
}

function scheduleBump(delayMs) {
  clearTimeout(bumpTimer);
  const minutes = Math.round(delayMs / 60000);
  if (minutes > 0) {
    console.log(`[Auto-Bump] Prochain bump dans ${minutes} minute(s).`);
  }
  bumpTimer = setTimeout(bump, delayMs);
}

try {
  require("ws");
} catch {
  console.error(' Module "ws" manquant. Lance : npm install ws');
  process.exit(1);
}

connectGateway();
