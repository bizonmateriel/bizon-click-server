const express = require("express");
const SibApiV3Sdk = require("sib-api-v3-sdk");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 10000;

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const ALERT_EMAIL = process.env.ALERT_EMAIL || "";
const OCCASION_URL =
  process.env.OCCASION_URL ||
  "https://www.actemis-manutention.com/occasion,materiel-manutention.php";

const SENDER_EMAIL =
  process.env.SENDER_EMAIL || ALERT_EMAIL || "no-reply@example.com";
const SENDER_NAME = process.env.SENDER_NAME || "Bizon Matériel";

const PHOTO_URL =
  "https://drive.google.com/thumbnail?id=1njdgz6MDpDUssp3he0QNLjKSiuKEzdpM&sz=w400";

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || "1j3Mz-Gnx0g823agXlwuKLjU5wb8EbMjsXG7fonqs8ug";

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";

const GOOGLE_PRIVATE_KEY =
  (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const TRACKING_SHEET_NAME = "Tracking";

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

  try {
    await appendTrackingRow("Ouverture", data);
  } catch (err) {
    console.error("Erreur tracking ouverture :", err.message || err);
  }

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
 * 1 clic = tracking + mail + redirection directe
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

  try {
    await appendTrackingRow("Clic occasion", data);
  } catch (err) {
    console.error("Erreur tracking occasion :", err.message || err);
  }

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
 * 1 clic = tracking + mail + page personnalisée
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

  try {
    await appendTrackingRow("Clic recontact", data);
  } catch (err) {
    console.error("Erreur tracking recontact :", err.message || err);
  }

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