require("dotenv").config();
const https = require("https");

const USER_TOKEN = process.env.TOKEN;
const BUMP_CHANNEL_ID = process.env.BUMP_CHANNEL_ID;

const DISBOARD_BOT_ID = "302050872383242240";
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000; 
const RETRY_DELAY_MS = 10 * 60 * 1000;
const DISCORD_API = "discord.com";

const CLIENT_BUILD_NUMBER = 336678;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const SUPER_PROPERTIES = Buffer.from(JSON.stringify({
  os: "Windows",
  browser: "Chrome",
  device: "",
  system_locale: "fr-FR",
  browser_user_agent: UA,
  browser_version: "125.0.0.0",
  os_version: "10",
  referrer: "",
  referring_domain: "",
  referrer_current: "",
  referring_domain_current: "",
  release_channel: "stable",
  client_build_number: CLIENT_BUILD_NUMBER,
  client_event_source: null,
})).toString("base64");

function jitter(base, rangeMs = 2500) {
  return base + Math.floor(Math.random() * rangeMs);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let lastBumpTime = 0;
let lastAttemptTime = 0;
let bumpTimer = null;
let nextBumpAt = 0;
let isBumping = false;
let isReconnecting = false;

function apiRequest(method, path, body = null, extraHeaders = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: DISCORD_API,
      path: `/api/v10${path}`,
      method,
      headers: {
        Authorization: USER_TOKEN,
        "Content-Type": "application/json",
        "User-Agent": UA,
        "X-Discord-Locale": "fr",
        "X-Discord-Timezone": "Europe/Paris",
        "X-Super-Properties": SUPER_PROPERTIES,
        "Origin": "https://discord.com",
        "Referer": `https://discord.com/channels/@me`,
        "Accept": "*/*",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        ...(extraHeaders ?? {}),
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
  const nonce = generateSnowflake();
  const body = {
    type: 2,
    application_id: DISBOARD_BOT_ID,
    guild_id: guildId,
    channel_id: BUMP_CHANNEL_ID,
    session_id: sessionId,
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

  const contextProps = Buffer.from(JSON.stringify({
    location: "slash_ui",
    location_guild_id: guildId,
    location_channel_id: BUMP_CHANNEL_ID,
    location_channel_type: 0,
  })).toString("base64");

  await sleep(jitter(300, 700));

  const res = await apiRequest("POST", "/interactions", body, {
    "X-Context-Properties": contextProps,
    "Referer": `https://discord.com/channels/${guildId}/${BUMP_CHANNEL_ID}`,
  });
  return res;
}

function generateSnowflake() {
  const DISCORD_EPOCH = 1420070400000n;
  const ts = BigInt(Date.now()) - DISCORD_EPOCH;
  const rand = BigInt(Math.floor(Math.random() * 0xfff));
  return String((ts << 22n) | (rand & 0x3FFFFn));
}

const WebSocket = require("ws");
let ws = null;
let heartbeatInterval = null;
let sessionId = null;
let sequence = null;

function connectGateway() {
  ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json", {
    headers: {
      "User-Agent": UA,
      "Origin": "https://discord.com",
    },
  });

  ws.on("open", () => console.log("[Gateway] Connecté au gateway Discord."));

  ws.on("message", async (data) => {
    const payload = JSON.parse(data);
    const { op, t, s, d } = payload;

    if (s) sequence = s;

    if (op === 10) {
      const interval = d.heartbeat_interval;
      heartbeatInterval = setInterval(() => {
        ws.send(JSON.stringify({ op: 1, d: sequence }));
      }, jitter(interval, 1000));

      await sleep(jitter(500, 1500));

      ws.send(
        JSON.stringify({
          op: 2,
          d: {
            token: USER_TOKEN,
            capabilities: 16381,
            properties: {
              os: "Windows",
              browser: "Chrome",
              device: "",
              system_locale: "fr-FR",
              browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
              browser_version: "125.0.0.0",
              os_version: "10",
              referrer: "",
              referring_domain: "",
              referrer_current: "",
              referring_domain_current: "",
              release_channel: "stable",
              client_build_number: CLIENT_BUILD_NUMBER,
              client_event_source: null,
            },
            presence: {
              status: "online",
              since: 0,
              activities: [],
              afk: false,
            },
            compress: false,
            client_state: {
              guild_versions: {},
              highest_last_message_id: "0",
              read_state_version: 0,
              user_guild_settings_version: -1,
              user_settings_version: -1,
              private_channels_version: "0",
              api_code_version: 0,
            },
          },
        })
      );
    }

    if (op === 0) {
      if (t === "READY") {
        isReconnecting = false;
        console.log(`[Auto-Bump] Connecté en tant que ${d.user.username}#${d.user.discriminator}`);
        sessionId = d.session_id;

        if (bumpTimer && nextBumpAt > Date.now()) {
          const remainingMin = Math.ceil((nextBumpAt - Date.now()) / 60000);
          console.log(`[Auto-Bump] Gateway reconnecté. Timer conservé : prochain bump dans ${remainingMin} minute(s).`);
        } else {
          scheduleBump(60 * 1000);
        }
      }

      if (t === "MESSAGE_CREATE") {
        if (
          d.author?.id === DISBOARD_BOT_ID &&
          d.channel_id === BUMP_CHANNEL_ID
        ) {
          handleDisboardMessage(d);
        }
      }

      if (t === "INTERACTION_CREATE") {
        if (
          d.application_id === DISBOARD_BOT_ID &&
          d.channel_id === BUMP_CHANNEL_ID &&
          d.data?.name === "bump"
        ) {
          const msg = d.message ?? d.data?.resolved ?? null;
          if (msg) handleDisboardMessage(msg);
        }
      }

      if (t === "MESSAGE_UPDATE") {
        if (
          d.author?.id === DISBOARD_BOT_ID &&
          d.channel_id === BUMP_CHANNEL_ID
        ) {
          handleDisboardMessage(d);
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
    if (!isReconnecting) {
      isReconnecting = true;
      console.warn("[Gateway] Déconnecté. Reconnexion dans 5s...");
      setTimeout(connectGateway, 5000);
    }
  });

  ws.on("error", (err) => console.error("[Gateway] Erreur :", err.message));
}

function reconnectGateway() {
  if (isReconnecting) return;
  isReconnecting = true;
  clearInterval(heartbeatInterval);
  ws?.terminate();
  setTimeout(connectGateway, 1000);
}

function getMessageText(message) {
  const parts = [
    message.content ?? "",
    message.embeds?.[0]?.title ?? "",
    message.embeds?.[0]?.description ?? "",
    ...(message.embeds?.[0]?.fields?.map((f) => `${f.name} ${f.value}`) ?? []),
  ];
  return parts.join(" ");
}

function parseCooldownMs(text) {
  const t = text.toLowerCase();
  let totalMs = 0;
  let found = false;

  // "X heure(s)" ou "X hour(s)"
  const hoursMatch = t.match(/(\d+)\s*(?:heures?|hours?)/);
  if (hoursMatch) {
    totalMs += Number(hoursMatch[1]) * 60 * 60 * 1000;
    found = true;
  }

  // "X minute(s)"
  const minutesMatch = t.match(/(\d+)\s*minute?s?/i);
  if (minutesMatch) {
    totalMs += Number(minutesMatch[1]) * 60 * 1000;
    found = true;
  }

  // "X seconde(s)" ou "X second(s)"
  const secondsMatch = t.match(/(\d+)\s*(?:secondes?|seconds?)/);
  if (secondsMatch) {
    totalMs += Number(secondsMatch[1]) * 1000;
    found = true;
  }

  // Timestamp Discord <t:UNIX:R> dans le texte
  const timestampMatch = text.match(/<t:(\d+)(?::[a-zA-Z])?>/);
  if (timestampMatch) {
    const targetMs = Number(timestampMatch[1]) * 1000;
    const remaining = targetMs - Date.now();
    if (remaining > 0) return remaining;
    found = false;
  }

  return found && totalMs > 0 ? totalMs : null;
}

function isCooldownMessage(text) {
  const t = text.toLowerCase();
  return (
    t.includes("attends encore") ||
    t.includes("wait") ||
    t.includes("please wait") ||
    t.includes("cooldown") ||
    t.includes("bumpé récemment") ||
    t.includes("bumped recently")
  );
}

function isDisboardSuccess(text) {
  const t = text.toLowerCase();
  return (
    t.includes("bump effectué") ||
    t.includes("bump done") ||
    t.includes("serveur bumpé") ||
    t.includes("server bumped") ||
    t.includes("bumped your server") ||
    t.includes(":thumbsup:")
  );
}

function handleDisboardMessage(messageData) {
  const text = getMessageText(messageData);
  const receivedAt = Date.now();

  if (isCooldownMessage(text)) {
    const cooldownMs = parseCooldownMs(text);
    if (cooldownMs !== null) {
      const minutes = Math.ceil(cooldownMs / 60000);
      console.log(`[Auto-Bump] Cooldown détecté : ${minutes} minute(s) restante(s). Timer ajusté précisément.`);
      scheduleBump(cooldownMs, true);
    } else {
      console.warn(`[Auto-Bump] Message de cooldown reçu mais durée non parsée : "${text.trim().slice(0, 120)}"`);
      scheduleBump(RETRY_DELAY_MS, true);
    }
    return;
  }

  if (isDisboardSuccess(text)) {
    console.log(`[Auto-Bump] Bump confirmé par Disboard à ${new Date(receivedAt).toLocaleTimeString("fr-FR")}. Prochain bump dans 2h.`);
    lastBumpTime = receivedAt;
    scheduleBump(BUMP_COOLDOWN_MS, true);
  }
}

async function bump() {
  if (isBumping) {
    console.warn("[Auto-Bump] Tentative ignorée : un bump est déjà en cours.");
    return;
  }

  const now = Date.now();
  const timeSinceLastAttempt = now - lastAttemptTime;
  if (lastAttemptTime && timeSinceLastAttempt < RETRY_DELAY_MS) {
    const remaining = RETRY_DELAY_MS - timeSinceLastAttempt;
    console.warn("[Auto-Bump] Tentative trop proche de la précédente. Reprogrammation.");
    scheduleBump(remaining);
    return;
  }

  isBumping = true;
  lastAttemptTime = now;

  try {
    console.log(`[Auto-Bump] Tentative de bump... (${new Date().toLocaleString("fr-FR")})`);

    const channel = await getChannel();
    const guildId = channel.guild_id;

    const bumpCommand = await getBumpCommand(guildId);
    if (!bumpCommand) {
      console.error("[Auto-Bump] ❌ Commande /bump introuvable. Disboard est-il sur le serveur ?");
      scheduleBump(RETRY_DELAY_MS);
      return;
    }

    const res = await sendBumpInteraction(guildId, bumpCommand);
    if (res.status === 204 || res.status === 200) {
      console.log(`[Auto-Bump]  /bump envoyé avec succès.`);
      lastBumpTime = Date.now();
      scheduleBump(BUMP_COOLDOWN_MS, true);
    } else {
      console.error(`[Auto-Bump]  Échec de l'envoi du bump. Status: ${res.status}`);
      if (res.body?.message) console.error(`[Auto-Bump] Discord: ${res.body.message}`);
      scheduleBump(RETRY_DELAY_MS);
    }
  } catch (err) {
    console.error("[Auto-Bump] Erreur :", err.message);
    scheduleBump(RETRY_DELAY_MS);
  } finally {
    isBumping = false;
  }
}

function scheduleBump(delayMs, force = false) {
  const safeDelay = Math.max(delayMs, 60 * 1000);
  const scheduledAt = Date.now() + safeDelay;

  if (!force && bumpTimer && nextBumpAt && nextBumpAt <= scheduledAt) {
    const currentMinutes = Math.ceil((nextBumpAt - Date.now()) / 60000);
    console.log(`[Auto-Bump] Timer déjà actif. Prochain bump dans ${currentMinutes} minute(s).`);
    return;
  }

  clearTimeout(bumpTimer);
  nextBumpAt = scheduledAt;

  const minutes = Math.ceil(safeDelay / 60000);
  console.log(`[Auto-Bump] Prochain bump dans ${minutes} minute(s).`);
  bumpTimer = setTimeout(() => {
    bumpTimer = null;
    nextBumpAt = 0;
    bump();
  }, safeDelay);
}

try {
  require("ws");
} catch {
  console.error(' Module "ws" manquant. Lance : npm install ws');
  process.exit(1);
}

connectGateway();
