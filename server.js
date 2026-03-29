const express = require("express");
const SibApiV3Sdk = require("sib-api-v3-sdk");

const app = express();
const PORT = process.env.PORT || 10000;

const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const ALERT_EMAIL = process.env.ALERT_EMAIL || "";
const OCCASION_URL =
  process.env.OCCASION_URL ||
  "https://www.actemis-manutention.com/occasion,materiel-manutention.php";
const SENDER_EMAIL = process.env.SENDER_EMAIL || ALERT_EMAIL || "no-reply@example.com";
const SENDER_NAME = process.env.SENDER_NAME || "Bizon Matériel";

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
 * ✅ ROUTES TECHNIQUES
 *******************************************************/
app.get("/", (req, res) => {
  res.status(200).send("OK - Bizon click server");
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

/*******************************************************
 * ✅ ROUTE OCCASION
 * 1 clic = mail envoyé + redirection directe
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
 * 1 clic = mail envoyé + page de confirmation
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
            background: #f7f7f7;
            color: #222;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .box {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 12px;
            padding: 30px;
            max-width: 520px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          }
          h1 {
            font-size: 24px;
            margin-bottom: 12px;
          }
          p {
            font-size: 16px;
            line-height: 1.5;
            margin: 8px 0;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>Votre demande a bien été prise en compte</h1>
          <p>Notre équipe vous recontactera dans les meilleurs délais.</p>
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
app.listen(PORT, () => {
  console.log(`Serveur lancé sur port ${PORT}`);
});