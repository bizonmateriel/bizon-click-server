const express = require("express");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const OCCASION_URL =
  process.env.OCCASION_URL ||
  "https://www.actemis-manutention.com/occasion,materiel-manutention.php";

const ALERT_EMAIL = process.env.ALERT_EMAIL || "f.clerc@bizon-materiel.fr";
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";

function asStr(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function escHtml(s) {
  return asStr(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nowFr() {
  return new Date().toLocaleString("fr-FR", {
    timeZone: "Europe/Paris"
  });
}

function buildMailBody(typeAction, q) {
  return [
    `Le client a effectué l'action : ${typeAction}`,
    "",
    "===== INFOS PROSPECT =====",
    `PROSPECT_ID : ${asStr(q.pid)}`,
    `Campagne : ${asStr(q.c)}`,
    `Raison sociale : ${asStr(q.rs)}`,
    `Code postal : ${asStr(q.cp)}`,
    `Code APE : ${asStr(q.ape)}`,
    `Groupe : ${asStr(q.g)}`,
    `Ville : ${asStr(q.ville)}`,
    `Mail : ${asStr(q.mail)}`,
    `Téléphone : ${asStr(q.tel)}`,
    `Date clic : ${nowFr()}`
  ].join("\n");
}

async function sendBrevoMail(subject, text) {
  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY manquante dans .env");
  }

  const payload = {
    sender: {
      name: "Serveur Bizon",
      email: ALERT_EMAIL
    },
    to: [
      {
        email: ALERT_EMAIL
      }
    ],
    subject,
    textContent: text
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": BREVO_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Brevo error ${res.status}: ${raw}`);
  }

  return raw;
}

app.get("/", (req, res) => {
  res.send("Serveur Bizon clics OK");
});

app.get("/occasion", async (req, res) => {
  try {
    const q = req.query;

    const subject = `Clic sur OCCASION - ${asStr(q.rs) || "Prospect inconnu"}`;
    const body = buildMailBody("Occasion", q);

    await sendBrevoMail(subject, body);

    return res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Occasions disponibles</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 40px;
              color: #222;
              background: #f7f7f7;
            }
            .box {
              max-width: 560px;
              margin: 40px auto;
              background: #fff;
              border: 1px solid #ddd;
              border-radius: 10px;
              padding: 30px;
            }
            a.btn {
              background: #f57c00;
              color: #fff;
              text-decoration: none;
              padding: 14px 24px;
              border-radius: 8px;
              font-weight: bold;
              display: inline-block;
              margin-top: 18px;
              font-size: 16px;
            }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>Occasions disponibles</h1>
            <p>Votre demande a bien été prise en compte.</p>
            <p>Cliquez sur le bouton ci-dessous pour accéder aux occasions disponibles.</p>
            <a class="btn" href="${escHtml(OCCASION_URL)}" target="_top">Accéder aux occasions</a>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Erreur /occasion :", err);
    return res.status(500).send("Erreur serveur sur /occasion");
  }
});

app.get("/recontact", async (req, res) => {
  try {
    const q = req.query;

    const subject = `Ce client souhaite être recontacté - ${asStr(q.rs) || "Prospect inconnu"}`;
    const body = buildMailBody("Être recontacté", q);

    await sendBrevoMail(subject, body);

    return res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Demande envoyée</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 40px;
              color: #222;
              background: #f7f7f7;
            }
            .box {
              max-width: 520px;
              margin: 40px auto;
              border: 1px solid #ddd;
              border-radius: 10px;
              padding: 30px;
              background: #fff;
            }
            h1 {
              font-size: 22px;
              margin-bottom: 12px;
            }
            p {
              font-size: 16px;
              line-height: 1.5;
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
  } catch (err) {
    console.error("Erreur /recontact :", err);
    return res.status(500).send("Erreur serveur sur /recontact");
  }
});

app.listen(port, () => {
  console.log("Serveur lancé sur port " + port);
});