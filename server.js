/*******************************************************
 * ✅ ROUTE OCCASION
 *******************************************************/
app.get('/occasion', async (req, res) => {
  const { pid = '', c = '', rs = '', cp = '', ape = '', g = '' } = req.query;
  const redirectUrl = process.env.OCCASION_URL;

  try {
    await sendAlertEmail({
      subject: `Clic sur OCCASION - ${rs || 'Prospect inconnu'}`,
      html: `
        <p>Le client a cliqué sur <b>Occasions disponibles</b>.</p>
        <p><b>PROSPECT_ID :</b> ${pid}</p>
        <p><b>Campagne :</b> ${c}</p>
        <p><b>Raison sociale :</b> ${rs}</p>
        <p><b>Code postal :</b> ${cp}</p>
        <p><b>Code APE :</b> ${ape}</p>
        <p><b>Groupe :</b> ${g}</p>
        <p><b>Date clic :</b> ${new Date().toLocaleString('fr-FR')}</p>
      `
    });
  } catch (e) {
    console.error('Erreur mail occasion :', e.message);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="2;url=${redirectUrl}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chargement des occasions</title>

        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #f7f7f7;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            color: #222;
          }

          .box {
            background: #fff;
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            max-width: 520px;
            border: 1px solid #ddd;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          }

          h1 {
            margin-bottom: 10px;
          }

          p {
            margin: 6px 0;
          }

          .btn {
            margin-top: 15px;
            display: inline-block;
            background: #f57c00;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
          }
        </style>
      </head>

      <body>
        <div class="box">
          <h1>Chargement des occasions...</h1>
          <p>Veuillez patienter quelques secondes.</p>
          <p>Vous allez être redirigé automatiquement.</p>

          <a class="btn" href="${redirectUrl}">
            Accéder aux occasions
          </a>
        </div>
      </body>
    </html>
  `);
});


/*******************************************************
 * ✅ ROUTE RECONTACT
 *******************************************************/
app.get('/recontact', async (req, res) => {
  const { pid = '', c = '', rs = '', cp = '', ape = '', g = '' } = req.query;

  try {
    await sendAlertEmail({
      subject: `Ce client souhaite être recontacté - ${rs || 'Prospect inconnu'}`,
      html: `
        <p>Le client souhaite être <b>recontacté</b>.</p>
        <p><b>PROSPECT_ID :</b> ${pid}</p>
        <p><b>Campagne :</b> ${c}</p>
        <p><b>Raison sociale :</b> ${rs}</p>
        <p><b>Code postal :</b> ${cp}</p>
        <p><b>Code APE :</b> ${ape}</p>
        <p><b>Groupe :</b> ${g}</p>
        <p><b>Date clic :</b> ${new Date().toLocaleString('fr-FR')}</p>
      `
    });
  } catch (e) {
    console.error('Erreur mail recontact :', e.message);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Demande envoyée</title>

        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #f7f7f7;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            color: #222;
          }

          .box {
            background: #fff;
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            max-width: 520px;
            border: 1px solid #ddd;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          }

          h1 {
            margin-bottom: 10px;
          }

          p {
            margin: 6px 0;
          }
        </style>
      </head>

      <body>
        <div class="box">
          <h1>Demande envoyée</h1>
          <p>Notre équipe va vous recontacter rapidement.</p>
        </div>
      </body>
    </html>
  `);
});