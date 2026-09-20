# GlowStock Android

Application Android 8.0+ connectée à https://glowstock.fr/. Connexion Internet requise. Le serveur, la base de données et les secrets ne sont pas embarqués.

## Construire

Depuis PowerShell : `powershell -ExecutionPolicy Bypass -File android/build.ps1`.
Prérequis : JDK Android Studio, SDK platform android-36 et build-tools 36.0.0. Les chemins peuvent être personnalisés avec `-Sdk` et `-Java`. Aucune dépendance à télécharger.

Résultat : `android/build/GlowStock-1.0.1.apk`. Transférer sur Android et autoriser l’installation depuis l’application qui ouvre le fichier.

Le certificat local de test est conservé dans `android/signing/` (ignoré par Git). Conserver ce dossier pour signer les mises à jour compatibles. Ce certificat et son mot de passe standard sont destinés aux essais ; préparer une clé de distribution protégée avant diffusion publique ou publication Play Store.

## Comportement

- Navigation interne limitée au domaine HTTPS glowstock.fr, autres liens HTTPS, e-mail et téléphone ouverts dans une application externe.
- Cookies et stockage Web conservés, bouton Retour et actualisation.
- Caméra demandée à Android uniquement pour la demande vidéo du site GlowStock.
- Import de fichiers via le sélecteur Android.
- Export CSV : ouvrir la page dans le navigateur depuis Options, se reconnecter si nécessaire et lancer l’export. Les téléchargements blob ne sont pas enregistrés directement par cette première version.
- Paiement Stripe ouvert dans le navigateur ; revenir dans l’application et actualiser après paiement.
- Aucun contournement des erreurs de certificat, aucun accès aux fichiers locaux ni pont JavaScript natif.

À vérifier sur un téléphone réel : connexion, scanner, import, export via navigateur, paiement, rotation et bouton Retour. La compilation et la signature ne remplacent pas ces essais.
