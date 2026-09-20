const { BrevoClient, BrevoEnvironment } = require('@getbrevo/brevo');
const data = require('../array.js');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
}[character]));

module.exports = async function mailBrevo(email, nom, token) {
  const publicUrl = String(data.env.PUBLIC_URL || 'https://glowstock.fr').replace(/\/+$/, '');
  const verificationUrl = `${publicUrl}/verif/?token=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(nom || '');

  const client = new BrevoClient({
    apiKey: data.env.BREVO_API_KEY,
    environment: BrevoEnvironment.PRODUCTION,
  });

  return client.transactionalEmails.sendTransacEmail({
    subject: 'Confirme ton adresse e-mail • GlowStock',
    textContent: `Bonjour ${nom || ''},\n\nBienvenue chez GlowStock ! Confirme ton adresse e-mail pour accéder à ton espace : ${verificationUrl}\n\nTon essai gratuit de 14 jours est activé.\n\nÀ bientôt,\nL’équipe GlowStock`,
    htmlContent: `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirme ton adresse e-mail — GlowStock</title>
  </head>
  <body style="margin:0;padding:0;background:#f7f3f0;color:#333130;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Ton espace GlowStock est presque prêt : confirme ton adresse e-mail.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f3f0;width:100%;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e7dedc;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="padding:30px 36px 24px;border-bottom:1px solid #eee6e3;">
                <div style="font-size:25px;line-height:1;font-weight:700;letter-spacing:-0.8px;color:#333130;">
                  <span style="display:inline-block;width:11px;height:11px;margin:0 9px 2px 0;border-radius:50%;background:#8fa393;"></span>GlowStock
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:42px 36px 10px;">
                <div style="display:inline-block;padding:8px 13px;border:1px solid #dbe5dc;border-radius:999px;background:#eff5ef;color:#758e76;font-size:13px;font-weight:700;letter-spacing:.2px;">COMPTE PRESQUE PRÊT</div>
                <h1 style="margin:24px 0 14px;font-size:34px;line-height:1.12;letter-spacing:-1.2px;color:#333130;">Bienvenue chez GlowStock ✨</h1>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#6f6868;">Bonjour ${safeName},</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#6f6868;">Ton espace de gestion de stock est prêt. Il ne reste qu’à confirmer ton adresse e-mail pour sécuriser ton compte.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
                  <tr>
                    <td align="center" style="border-radius:14px;background:#8fa393;">
                      <a href="${verificationUrl}" style="display:inline-block;padding:15px 23px;border:1px solid #8fa393;border-radius:14px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Confirmer mon adresse</a>
                    </td>
                  </tr>
                </table>
                <div style="padding:17px 18px;border-radius:15px;background:#f9eef1;color:#665c5d;font-size:14px;line-height:1.55;">🎁 Ton essai gratuit de <strong>14 jours</strong> est activé dès maintenant.</div>
                <p style="margin:26px 0 0;font-size:13px;line-height:1.6;color:#918889;">Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :<br><a href="${verificationUrl}" style="color:#758e76;word-break:break-all;">${verificationUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 36px 30px;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#918889;">Tu n’es pas à l’origine de cette demande ? Tu peux ignorer cet e-mail.</p>
                <p style="margin:14px 0 0;font-size:13px;color:#aaa1a1;">L’équipe GlowStock · glowstock.fr</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    sender: { name: 'GlowStock', email: 'contact@glowstock.fr' },
    to: [{ email: email, name: nom }],
  });
};
