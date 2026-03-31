const express = require("express");
const SibApiV3Sdk = require("sib-api-v3-sdk");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const ALERT_EMAIL = process.env.ALERT_EMAIL || "";

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";

const GOOGLE_PRIVATE_KEY =
  (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || "1j3Mz-Gnx0g823agXlwuKLjU5wb8EbMjsXG7fonqs8ug";

const OCCASION_URL =
  process.env.OCCASION_URL ||
  "https://www.actemis-manutention.com/occasion,materiel-manutention.php";

const SENDER_EMAIL =
  process.env.SENDER_EMAIL || ALERT_EMAIL || "no-reply@example.com";

const SENDER_NAME = process.env.SENDER_NAME || "Bizon Matériel";

const PHOTO_URL =
  "https://drive.google.com/thumbnail?id=1njdgz6MDpDUssp3he0QNLjKSiuKEzdpM&sz=w400";

const TRACKING_SHEET_NAME = "Tracking";
const PROSPECTS_SHEET_NAME = "Prospects";
const PARAMS_SHEET_NAME = "Parametres";

// Colonnes de synthèse dans Prospects
const COL_PROSPECT_ID = "O";
const COL_NB_OUVERTURES = "P";
const COL_NB_CLICS_OCCASION = "Q";
const COL_NB_CLICS_RECONTACT = "R";

// Anti doublon ouverture : 5 minutes
const OPEN_DEDUP_MINUTES = 5;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/*******************************************************
 * ✅ CONFIG BREVO
 *******************************************************/
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications["api-key"];
apiKey.apiKey = BREVO_API_KEY;

/*******************************************************
 * ✅ OUTILS
 *******************************************************/
function asTrimStr(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function escapeHtml(s) {
  return asTrimStr(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateFR(d) {
  return new Date(d).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris"
  });
}

function getPixelBuffer() {
  return Buffer.from(
    "R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
    "base64"
  );
}

function toInt(v) {
  const n = parseInt(asTrimStr(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseIsoDateSafe(v) {
  const s = asTrimStr(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function displayOrFallback(value, fallback = "—") {
  const v = asTrimStr(value);
  return v ? escapeHtml(v) : fallback;
}

/*******************************************************
 * ✅ BREVO
 *******************************************************/
async function sendAlertEmail({ subject, html, text }) {
  if (!BREVO_API_KEY) throw new Error("BREVO_API_KEY manquante");
  if (!ALERT_EMAIL) throw new Error("ALERT_EMAIL manquante");

  const api = new SibApiV3Sdk.TransactionalEmailsApi();
  const mail = new SibApiV3Sdk.SendSmtpEmail();

  mail.sender = {
    email: SENDER_EMAIL,
    name: SENDER_NAME
  };

  mail.to = [{ email: ALERT_EMAIL }];
  mail.subject = subject;
  mail.htmlContent = html;
  mail.textContent = text;

  return await api.sendTransacEmail(mail);
}

function buildAlertHtml(title, data) {
  return `
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
      </head>
      <body style="font-family:Arial,sans-serif;color:#222;line-height:1.5;">
        <h2>${escapeHtml(title)}</h2>
        <p><strong>PROSPECT_ID :</strong> ${escapeHtml(data.pid)}</p>
        <p><strong>Campagne :</strong> ${escapeHtml(data.c)}</p>
        <p><strong>Raison sociale :</strong> ${escapeHtml(data.rs)}</p>
        <p><strong>Code postal :</strong> ${escapeHtml(data.cp)}</p>
        <p><strong>Code APE :</strong> ${escapeHtml(data.ape)}</p>
        <p><strong>Groupe :</strong> ${escapeHtml(data.g)}</p>
        <p><strong>Date clic :</strong> ${escapeHtml(formatDateFR(new Date()))}</p>
      </body>
    </html>
  `;
}

function buildAlertText(title, data) {
  return [
    title,
    "",
    `PROSPECT_ID : ${asTrimStr(data.pid)}`,
    `Campagne : ${asTrimStr(data.c)}`,
    `Raison sociale : ${asTrimStr(data.rs)}`,
    `Code postal : ${asTrimStr(data.cp)}`,
    `Code APE : ${asTrimStr(data.ape)}`,
    `Groupe : ${asTrimStr(data.g)}`,
    `Date clic : ${formatDateFR(new Date())}`
  ].join("\n");
}

/*******************************************************
 * ✅ GOOGLE SHEETS
 *******************************************************/
async function getSheetsClient() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL manquante");
  }

  if (!GOOGLE_PRIVATE_KEY) {
    throw new Error("GOOGLE_PRIVATE_KEY manquante");
  }

  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

function buildTrackingRow(eventName, data) {
  return [
    new Date().toISOString(),
    asTrimStr(eventName),
    asTrimStr(data.c),
    asTrimStr(data.pid),
    asTrimStr(data.rs),
    asTrimStr(data.cp),
    asTrimStr(data.ape),
    asTrimStr(data.g)
  ];
}

async function appendTrackingRow(eventName, data) {
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TRACKING_SHEET_NAME}!A:H`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [buildTrackingRow(eventName, data)]
    }
  });
}

/*******************************************************
 * ✅ RECHERCHE PROSPECT PAR PID
 *******************************************************/
async function findProspectRowByPid(pid) {
  const cleanPid = asTrimStr(pid);
  if (!cleanPid) return null;

  const sheets = await getSheetsClient();

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${PROSPECTS_SHEET_NAME}!${COL_PROSPECT_ID}:${COL_PROSPECT_ID}`
  });

  const values = resp.data.values || [];

  for (let i = 0; i < values.length; i++) {
    const cellValue = asTrimStr(values[i] && values[i][0]);
    if (cellValue === cleanPid) {
      return i + 1;
    }
  }

  return null;
}

/*******************************************************
 * ✅ INCRÉMENT COMPTEURS
 *******************************************************/
async function incrementProspectCounter(pid, columnLetter) {
  const cleanPid = asTrimStr(pid);
  if (!cleanPid) {
    console.log(`Compteur non incrémenté : pid vide pour colonne ${columnLetter}`);
    return;
  }

  const row = await findProspectRowByPid(cleanPid);

  if (!row) {
    console.log(`Prospect introuvable pour pid=${cleanPid}`);
    return;
  }

  const sheets = await getSheetsClient();
  const cellRange = `${PROSPECTS_SHEET_NAME}!${columnLetter}${row}`;

  const currentResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: cellRange
  });

  const currentValue =
    currentResp.data.values &&
    currentResp.data.values[0] &&
    currentResp.data.values[0][0];

  const nextValue = toInt(currentValue) + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: cellRange,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[nextValue]]
    }
  });

  console.log(`Compteur ${columnLetter}${row} mis à jour : ${nextValue}`);
}

/*******************************************************
 * ✅ ANTI-DOUBLON OUVERTURE
 *******************************************************/
async function getLastOpenDateForPid(pid) {
  const cleanPid = asTrimStr(pid);
  if (!cleanPid) return null;

  const sheets = await getSheetsClient();

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TRACKING_SHEET_NAME}!A:D`
  });

  const values = resp.data.values || [];
  let lastDate = null;

  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i] || [];
    const dateStr = asTrimStr(row[0]);
    const eventName = asTrimStr(row[1]);
    const rowPid = asTrimStr(row[3]);

    if (eventName === "Ouverture" && rowPid === cleanPid) {
      lastDate = parseIsoDateSafe(dateStr);
      break;
    }
  }

  return lastDate;
}

async function shouldIncrementOpenCounter(pid) {
  const cleanPid = asTrimStr(pid);
  if (!cleanPid) return false;

  const lastOpen = await getLastOpenDateForPid(cleanPid);

  if (!lastOpen) {
    return true;
  }

  const now = new Date();
  const diffMs = now.getTime() - lastOpen.getTime();
  const diffMinutes = diffMs / 1000 / 60;

  return diffMinutes > OPEN_DEDUP_MINUTES;
}

/*******************************************************
 * ✅ TRACKING + COMPTEURS
 *******************************************************/
async function trackEventAndIncrementCounter(eventName, data, columnLetter) {
  try {
    await appendTrackingRow(eventName, data);
  } catch (err) {
    console.error(`Erreur tracking ${eventName} :`, err.message || err);
  }

  try {
    await incrementProspectCounter(data.pid, columnLetter);
  } catch (err) {
    console.error(`Erreur compteur ${eventName} :`, err.message || err);
  }
}

async function trackOpenWithDedup(data) {
  let incrementOpen = true;

  try {
    incrementOpen = await shouldIncrementOpenCounter(data.pid);
  } catch (err) {
    console.error("Erreur anti-doublon ouverture :", err.message || err);
    incrementOpen = true;
  }

  try {
    await appendTrackingRow("Ouverture", data);
  } catch (err) {
    console.error("Erreur tracking ouverture :", err.message || err);
  }

  if (!incrementOpen) {
    console.log(`Ouverture dédoublonnée pour pid=${asTrimStr(data.pid)}`);
    return;
  }

  try {
    await incrementProspectCounter(data.pid, COL_NB_OUVERTURES);
  } catch (err) {
    console.error("Erreur compteur ouverture :", err.message || err);
  }
}

/*******************************************************
 * ✅ DASHBOARD HELPERS
 *******************************************************/
function buildTop20(arr) {
  const sorted = arr
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push(sorted[i] ? sorted[i].label : "");
  }
  return out;
}

function buildTop20Cp(mapObj) {
  const sorted = Object.entries(mapObj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push(sorted[i] ? sorted[i][0] : "");
  }
  return out;
}

function getParamCell(params, rowIndex0, colIndex0) {
  return params[rowIndex0] && params[rowIndex0][colIndex0]
    ? params[rowIndex0][colIndex0]
    : "";
}

function normalizeDateTimeValue(v) {
  return asTrimStr(v);
}

function renderTopList(items) {
  return items
    .map((item, index) => {
      return `
        <div class="rank-row">
          <div class="rank-num">${index + 1}</div>
          <div class="rank-label">${escapeHtml(item || "")}</div>
        </div>
      `;
    })
    .join("");
}

async function getDashboardData() {
  const sheets = await getSheetsClient();

  const [prospectsRes, paramsRes, trackingRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${PROSPECTS_SHEET_NAME}!A2:S`
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${PARAMS_SHEET_NAME}!A1:M20`
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TRACKING_SHEET_NAME}!A:H`
    })
  ]);

  const prospects = prospectsRes.data.values || [];
  const params = paramsRes.data.values || [];
  const tracking = trackingRes.data.values || [];

  const paramData = {
    groupes: getParamCell(params, 2, 12),        // M3
    filtreCP: getParamCell(params, 4, 0),        // A5
    campagneId: getParamCell(params, 5, 0),      // A6
    statut: getParamCell(params, 12, 3),         // D13
    dernierEnvoi: normalizeDateTimeValue(getParamCell(params, 13, 3)), // D14
    nbEnvoye: getParamCell(params, 14, 3),       // D15
    prochainEnvoi: normalizeDateTimeValue(getParamCell(params, 15, 3)) // D16
  };

  const topOuverturesRaw = [];
  const topOccasionRaw = [];
  const topRecontactRaw = [];
  const cpMap = {};

  prospects.forEach((row) => {
    const rs = asTrimStr(row[0]);   // A
    const cp = asTrimStr(row[2]);   // C
    const open = toInt(row[15]);    // P
    const occ = toInt(row[16]);     // Q
    const rec = toInt(row[17]);     // R
    const score = toInt(row[18]);   // S

    if (rs) {
      topOuverturesRaw.push({ label: rs, value: open });
      topOccasionRaw.push({ label: rs, value: occ });
      topRecontactRaw.push({ label: rs, value: rec });
    }

    if (cp && score > 0) {
      cpMap[cp] = (cpMap[cp] || 0) + score;
    }
  });

  const topOuvertures = buildTop20(topOuverturesRaw);
  const topOccasion = buildTop20(topOccasionRaw);
  const topRecontact = buildTop20(topRecontactRaw);
  const topCP = buildTop20Cp(cpMap);

  const currentCampaignId = asTrimStr(paramData.campagneId);
  const lastSendCount = toInt(paramData.nbEnvoye);

  const trackingRows = tracking.slice(1);
  const campaignRows = trackingRows.filter((row) => {
    return asTrimStr(row[2]) === currentCampaignId;
  });

  const openPids = new Set();
  const clickPids = new Set();

  campaignRows.forEach((row) => {
    const eventName = asTrimStr(row[1]);
    const pid = asTrimStr(row[3]);

    if (!pid) return;

    if (eventName === "Ouverture") {
      openPids.add(pid);
    }

    if (eventName === "Clic occasion" || eventName === "Clic recontact") {
      clickPids.add(pid);
    }
  });

  const lastOpenRate = lastSendCount > 0 ? openPids.size / lastSendCount : 0;
  const lastClickRate = lastSendCount > 0 ? clickPids.size / lastSendCount : 0;

  // Temporaire : moyenne = dernier taux tant qu'on n'a pas l'historique par bloc
  const averageOpenRate = lastOpenRate;
  const averageClickRate = lastClickRate;

  return {
    paramData,
    topOuvertures,
    topOccasion,
    topRecontact,
    topCP,
    rates: {
      averageOpenRate,
      averageClickRate,
      lastOpenRate,
      lastClickRate,
      averageOpenRateLabel: formatPercent(averageOpenRate),
      averageClickRateLabel: formatPercent(averageClickRate),
      lastOpenRateLabel: formatPercent(lastOpenRate),
      lastClickRateLabel: formatPercent(lastClickRate)
    }
  };
}

/*******************************************************
 * ✅ ROUTES
 *******************************************************/
app.get("/", (req, res) => {
  return res.redirect("/dashboard");
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

/*******************************************************
 * ✅ PIXEL OUVERTURE
 *******************************************************/
app.get("/open", async (req, res) => {
  const data = {
    pid: asTrimStr(req.query.pid),
    c: asTrimStr(req.query.c),
    rs: asTrimStr(req.query.rs),
    cp: asTrimStr(req.query.cp),
    ape: asTrimStr(req.query.ape),
    g: asTrimStr(req.query.g)
  };

  await trackOpenWithDedup(data);

  const img = getPixelBuffer();

  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": img.length,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0"
  });

  res.end(img);
});

/*******************************************************
 * ✅ ROUTE OCCASION
 *******************************************************/
app.get("/occasion", async (req, res) => {
  const data = {
    pid: asTrimStr(req.query.pid),
    c: asTrimStr(req.query.c),
    rs: asTrimStr(req.query.rs),
    cp: asTrimStr(req.query.cp),
    ape: asTrimStr(req.query.ape),
    g: asTrimStr(req.query.g)
  };

  await trackEventAndIncrementCounter(
    "Clic occasion",
    data,
    COL_NB_CLICS_OCCASION
  );

  try {
    await sendAlertEmail({
      subject: `Clic sur OCCASION - ${data.rs || "Prospect inconnu"}`,
      html: buildAlertHtml("Le client a cliqué sur Occasions disponibles", data),
      text: buildAlertText("Le client a cliqué sur Occasions disponibles", data)
    });
  } catch (err) {
    console.error("Erreur mail occasion :", err.message || err);
  }

  return res.redirect(OCCASION_URL);
});

/*******************************************************
 * ✅ ROUTE RECONTACT
 *******************************************************/
app.get("/recontact", async (req, res) => {
  const data = {
    pid: asTrimStr(req.query.pid),
    c: asTrimStr(req.query.c),
    rs: asTrimStr(req.query.rs),
    cp: asTrimStr(req.query.cp),
    ape: asTrimStr(req.query.ape),
    g: asTrimStr(req.query.g)
  };

  await trackEventAndIncrementCounter(
    "Clic recontact",
    data,
    COL_NB_CLICS_RECONTACT
  );

  try {
    await sendAlertEmail({
      subject: `Ce client souhaite être recontacté - ${data.rs || "Prospect inconnu"}`,
      html: buildAlertHtml("Le client souhaite être recontacté", data),
      text: buildAlertText("Le client souhaite être recontacté", data)
    });
  } catch (err) {
    console.error("Erreur mail recontact :", err.message || err);
  }

  res.send(`
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Demande envoyée</title>
        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #f4f4f4;
            color: #222;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
          }
          .box {
            background: #ffffff;
            border: 1px solid #dddddd;
            border-radius: 14px;
            padding: 30px;
            max-width: 520px;
            width: 100%;
            text-align: center;
            box-shadow: 0 6px 24px rgba(0,0,0,0.08);
          }
          h1 {
            font-size: 28px;
            margin: 0 0 12px 0;
            line-height: 1.3;
          }
          .subtitle {
            font-size: 18px;
            margin-bottom: 20px;
            color: #333;
          }
          .photo {
            width: 140px;
            height: 140px;
            border-radius: 50%;
            object-fit: cover;
            display: block;
            margin: 18px auto;
            border: 4px solid #f0f0f0;
            background: #fff;
          }
          .name {
            font-size: 22px;
            font-weight: bold;
            margin-top: 8px;
          }
          .role {
            font-size: 16px;
            color: #666;
            margin-top: 4px;
          }
          .phone {
            font-size: 24px;
            font-weight: bold;
            margin-top: 18px;
            color: #111;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>Votre demande a bien été prise en compte</h1>
          <div class="subtitle">
            Florent vous rappelle dans les plus brefs délais.
          </div>
          <img class="photo" src="${escapeHtml(PHOTO_URL)}" alt="Florent Clerc">
          <div class="name">Florent Clerc</div>
          <div class="role">Commercial BTP - Secteur 83</div>
          <div class="phone">📞 06 71 27 45 75</div>
        </div>
      </body>
    </html>
  `);
});

/*******************************************************
 * ✅ API DASHBOARD
 *******************************************************/
app.get("/api/dashboard", async (req, res) => {
  try {
    const data = await getDashboardData();

    res.json({
      success: true,
      ...data
    });
  } catch (err) {
    console.error("Erreur /api/dashboard :", err.message || err);
    res.status(500).json({
      success: false,
      error: "Erreur dashboard"
    });
  }
});

/*******************************************************
 * ✅ PAGE DASHBOARD VISUELLE
 *******************************************************/
app.get("/dashboard", async (req, res) => {
  try {
    const data = await getDashboardData();
    const { paramData, topOuvertures, topOccasion, topRecontact, topCP, rates } = data;

    const statusValue = asTrimStr(paramData.statut).toUpperCase();
    const statusClass = statusValue === "ACTIF" ? "status-active" : "status-stop";

    res.send(`
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Bizon Dashboard</title>
          <style>
            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              font-family: Inter, Arial, sans-serif;
              background:
                radial-gradient(circle at top left, #2a2f3a 0%, #171a21 35%, #111318 100%);
              color: #f3f5f7;
            }

            .page {
              max-width: 1500px;
              margin: 0 auto;
              padding: 28px;
            }

            .hero {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 20px;
              margin-bottom: 24px;
              padding: 26px 28px;
              border-radius: 24px;
              background: linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04));
              border: 1px solid rgba(255,255,255,0.10);
              box-shadow: 0 14px 40px rgba(0,0,0,0.22);
            }

            .hero-left h1 {
              margin: 0;
              font-size: 34px;
              font-weight: 800;
              letter-spacing: -0.02em;
            }

            .hero-left p {
              margin: 8px 0 0 0;
              color: #bcc4cf;
              font-size: 15px;
            }

            .hero-right {
              display: flex;
              align-items: center;
              gap: 12px;
              flex-wrap: wrap;
            }

            .chip {
              padding: 10px 14px;
              border-radius: 999px;
              font-size: 13px;
              font-weight: 700;
              border: 1px solid rgba(255,255,255,0.10);
              background: rgba(255,255,255,0.06);
              color: #f3f5f7;
            }

            .status-active {
              background: rgba(0,176,80,0.18);
              color: #70f1a4;
              border-color: rgba(112,241,164,0.35);
            }

            .status-stop {
              background: rgba(255,65,65,0.16);
              color: #ff9b9b;
              border-color: rgba(255,155,155,0.35);
            }

            .kpis {
              display: grid;
              grid-template-columns: repeat(2, minmax(260px, 1fr));
              gap: 20px;
              margin-bottom: 24px;
            }

            .kpi-card {
              position: relative;
              overflow: hidden;
              padding: 24px;
              border-radius: 24px;
              background: linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05));
              border: 1px solid rgba(255,255,255,0.10);
              box-shadow: 0 14px 34px rgba(0,0,0,0.20);
            }

            .kpi-card::after {
              content: "";
              position: absolute;
              top: -40px;
              right: -30px;
              width: 140px;
              height: 140px;
              border-radius: 50%;
              background: rgba(255,255,255,0.06);
            }

            .kpi-label {
              position: relative;
              z-index: 1;
              font-size: 13px;
              text-transform: uppercase;
              letter-spacing: 0.12em;
              color: #b8c0cc;
              margin-bottom: 12px;
              font-weight: 700;
            }

            .kpi-value {
              position: relative;
              z-index: 1;
              font-size: 62px;
              line-height: 1;
              font-weight: 800;
              letter-spacing: -0.05em;
              margin-bottom: 10px;
            }

            .kpi-sub {
              position: relative;
              z-index: 1;
              font-size: 14px;
              color: #c8d0da;
            }

            .tops-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 20px;
              margin-bottom: 24px;
            }

            .panel {
              border-radius: 24px;
              background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
              border: 1px solid rgba(255,255,255,0.10);
              box-shadow: 0 14px 34px rgba(0,0,0,0.18);
              overflow: hidden;
            }

            .panel-header {
              padding: 18px 20px;
              border-bottom: 1px solid rgba(255,255,255,0.08);
              display: flex;
              justify-content: space-between;
              align-items: center;
            }

            .panel-title {
              margin: 0;
              font-size: 18px;
              font-weight: 800;
              color: #ffffff;
            }

            .panel-badge {
              font-size: 12px;
              font-weight: 700;
              color: #c2cad5;
              padding: 8px 10px;
              border-radius: 999px;
              background: rgba(255,255,255,0.06);
            }

            .panel-body {
              padding: 10px 14px 16px 14px;
            }

            .rank-row {
              display: grid;
              grid-template-columns: 42px 1fr;
              gap: 10px;
              align-items: center;
              min-height: 40px;
              padding: 8px 8px;
              border-radius: 12px;
            }

            .rank-row:nth-child(odd) {
              background: rgba(255,255,255,0.03);
            }

            .rank-num {
              width: 30px;
              height: 30px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 13px;
              font-weight: 800;
              color: #ffffff;
              background: rgba(255,255,255,0.10);
            }

            .rank-label {
              font-size: 14px;
              color: #ecf1f6;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            .summary-panel {
              border-radius: 24px;
              background: linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.04));
              border: 1px solid rgba(255,255,255,0.10);
              box-shadow: 0 14px 34px rgba(0,0,0,0.18);
              overflow: hidden;
            }

            .summary-header {
              padding: 20px 24px;
              border-bottom: 1px solid rgba(255,255,255,0.08);
            }

            .summary-header h2 {
              margin: 0;
              font-size: 22px;
              font-weight: 800;
            }

            .summary-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 16px;
              padding: 20px;
            }

            .summary-item {
              padding: 18px;
              border-radius: 18px;
              background: rgba(255,255,255,0.05);
              border: 1px solid rgba(255,255,255,0.06);
              min-height: 110px;
            }

            .summary-label {
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.10em;
              color: #adb7c4;
              font-weight: 800;
              margin-bottom: 10px;
            }

            .summary-value {
              font-size: 18px;
              line-height: 1.45;
              font-weight: 700;
              color: #ffffff;
              word-break: break-word;
            }

            @media (max-width: 1100px) {
              .tops-grid,
              .summary-grid,
              .kpis {
                grid-template-columns: 1fr;
              }

              .hero {
                flex-direction: column;
                align-items: flex-start;
              }

              .kpi-value {
                font-size: 48px;
              }
            }

            @media (max-width: 640px) {
              .page {
                padding: 16px;
              }

              .hero {
                padding: 20px;
                border-radius: 20px;
              }

              .hero-left h1 {
                font-size: 28px;
              }

              .panel-header,
              .summary-header {
                padding: 16px;
              }

              .summary-item {
                min-height: auto;
              }
            }
          </style>
        </head>
        <body>
          <div class="page">
            <section class="hero">
              <div class="hero-left">
                <h1>Bizon Dashboard</h1>
                <p>Pilotage commercial et suivi de campagne</p>
              </div>

              <div class="hero-right">
                <div class="chip">Campagne : ${displayOrFallback(paramData.campagneId, "Aucune")}</div>
                <div class="chip ${statusClass}">Statut : ${displayOrFallback(paramData.statut, "STOP")}</div>
              </div>
            </section>

            <section class="kpis">
              <div class="kpi-card">
                <div class="kpi-label">Taux d'ouverture moyen</div>
                <div class="kpi-value">${rates.averageOpenRateLabel}</div>
                <div class="kpi-sub">Base actuelle de la campagne en cours</div>
              </div>

              <div class="kpi-card">
                <div class="kpi-label">Taux de clic moyen</div>
                <div class="kpi-value">${rates.averageClickRateLabel}</div>
                <div class="kpi-sub">Clic occasion + clic recontact</div>
              </div>
            </section>

            <section class="tops-grid">
              <div class="panel">
                <div class="panel-header">
                  <h2 class="panel-title">Top 20 ouvertures</h2>
                  <div class="panel-badge">20 lignes</div>
                </div>
                <div class="panel-body">
                  ${renderTopList(topOuvertures)}
                </div>
              </div>

              <div class="panel">
                <div class="panel-header">
                  <h2 class="panel-title">Top 20 clic occasion</h2>
                  <div class="panel-badge">20 lignes</div>
                </div>
                <div class="panel-body">
                  ${renderTopList(topOccasion)}
                </div>
              </div>

              <div class="panel">
                <div class="panel-header">
                  <h2 class="panel-title">Top 20 clic recontact</h2>
                  <div class="panel-badge">20 lignes</div>
                </div>
                <div class="panel-body">
                  ${renderTopList(topRecontact)}
                </div>
              </div>

              <div class="panel">
                <div class="panel-header">
                  <h2 class="panel-title">Top 20 codes postaux</h2>
                  <div class="panel-badge">20 lignes</div>
                </div>
                <div class="panel-body">
                  ${renderTopList(topCP)}
                </div>
              </div>
            </section>

            <section class="summary-panel">
              <div class="summary-header">
                <h2>Résumé de la campagne en cours</h2>
              </div>

              <div class="summary-grid">
                <div class="summary-item">
                  <div class="summary-label">Groupes concernés</div>
                  <div class="summary-value">${displayOrFallback(paramData.groupes)}</div>
                </div>

                <div class="summary-item">
                  <div class="summary-label">Codes postaux concernés</div>
                  <div class="summary-value">${displayOrFallback(paramData.filtreCP, "Tous")}</div>
                </div>

                <div class="summary-item">
                  <div class="summary-label">Nombre d'envoi journalier</div>
                  <div class="summary-value">${displayOrFallback(paramData.nbEnvoye, "0")}</div>
                </div>

                <div class="summary-item">
                  <div class="summary-label">État de la campagne</div>
                  <div class="summary-value">${displayOrFallback(paramData.statut, "STOP")}</div>
                </div>

                <div class="summary-item">
                  <div class="summary-label">Dernier envoi effectué</div>
                  <div class="summary-value">${displayOrFallback(paramData.dernierEnvoi)}</div>
                </div>

                <div class="summary-item">
                  <div class="summary-label">Nombre envoyé de la journée</div>
                  <div class="summary-value">${displayOrFallback(paramData.nbEnvoye, "0")}</div>
                </div>

                <div class="summary-item">
                  <div class="summary-label">Taux d'ouverture du dernier envoi</div>
                  <div class="summary-value">${rates.lastOpenRateLabel}</div>
                </div>

                <div class="summary-item">
                  <div class="summary-label">Taux de clic du dernier envoi</div>
                  <div class="summary-value">${rates.lastClickRateLabel}</div>
                </div>

                <div class="summary-item">
                  <div class="summary-label">Prochain envoi</div>
                  <div class="summary-value">${displayOrFallback(paramData.prochainEnvoi, "Non programmé")}</div>
                </div>
              </div>
            </section>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Erreur /dashboard :", err.message || err);
    res.status(500).send("Erreur dashboard visuel");
  }
});

/*******************************************************
 * ✅ 404
 *******************************************************/
app.use((req, res) => {
  res.status(404).send("Route introuvable");
});

/*******************************************************
 * ✅ LANCEMENT
 *******************************************************/
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur lancé sur port ${PORT}`);
});