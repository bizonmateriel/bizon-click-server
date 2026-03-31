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

function toFloat(v) {
  const n = parseFloat(asTrimStr(v).replace(",", "."));
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
 * ✅ DERNIÈRE OUVERTURE POUR ANTI-DOUBLON
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
 * ✅ CALCULS DASHBOARD
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

/*******************************************************
 * ✅ ROUTES TECHNIQUES
 *******************************************************/
app.get("/", (req, res) => {
  res.status(200).send("OK - Bizon click server");
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
 * Page 1 Bizon
 *******************************************************/
app.get("/api/dashboard", async (req, res) => {
  try {
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

    /*******************************************************
     * PARAMÈTRES CAMPAGNE
     *******************************************************/
    const paramData = {
      groupes: getParamCell(params, 2, 12),        // M3
      filtreCP: getParamCell(params, 4, 0),        // A5
      campagneId: getParamCell(params, 5, 0),      // A6
      statut: getParamCell(params, 12, 3),         // D13
      dernierEnvoi: normalizeDateTimeValue(getParamCell(params, 13, 3)),   // D14
      nbEnvoye: getParamCell(params, 14, 3),       // D15
      prochainEnvoi: normalizeDateTimeValue(getParamCell(params, 15, 3))   // D16
    };

    /*******************************************************
     * TOP 20
     *******************************************************/
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

    /*******************************************************
     * TAUX DERNIER ENVOI + MOYENNES
     * Base actuelle :
     * - on utilise Tracking
     * - on groupe par campagne
     * - on calcule :
     *   ouverture = nb pid uniques ayant ouvert / nb envoyé du bloc
     *   clic = nb pid uniques ayant cliqué / nb envoyé du bloc
     *
     * Ici, faute d'un onglet runs dédié, on prend :
     * - nbEnvoye (D15) comme taille du dernier bloc
     * - la campagne courante (A6) pour filtrer
     *******************************************************/
    const currentCampaignId = asTrimStr(paramData.campagneId);
    const lastSendCount = toInt(paramData.nbEnvoye);

    const trackingRows = tracking.slice(1); // on saute l'entête
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

    /*******************************************************
     * MOYENNES
     * Pour l'instant :
     * si tu n'as pas encore d'historique par bloc séparé,
     * on renvoie la même base que la campagne en cours.
     * On pourra l'affiner après avec un vrai stockage par run.
     *******************************************************/
    const averageOpenRate = lastOpenRate;
    const averageClickRate = lastClickRate;

    /*******************************************************
     * RÉPONSE FINALE
     *******************************************************/
    res.json({
      success: true,
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