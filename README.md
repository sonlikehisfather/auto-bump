# Auto-Bump Bot

Bot qui bump automatiquement ton serveur Discord via la commande `/bump` de Disboard toutes les 2 heures.

> **Ce bot utilise un user token (selfbot), ce qui est contre les ToS de Discord. Utilise à tes risques.**

## Installation

```bash
npm install
```

## Configuration

Crée un fichier `.env` à la racine du projet :

```
TOKEN=ton_user_token_discord
BUMP_CHANNEL_ID=id_du_channel_de_bump
```

### Comment obtenir ton user token ?
1. Ouvre Discord dans le navigateur (discord.com)
2. Ouvre les DevTools (F12) → Onglet **Network**
3. Tape un message dans n'importe quel channel
4. Cherche une requête vers `messages` → Headers → `Authorization`
5. Copie la valeur (commence par `MTI...` ou similar)

### Comment obtenir l'ID du channel ?
1. Active le **Mode Développeur** dans Discord (Paramètres → Avancé)
2. Clic droit sur le channel → **Copier l'ID**

## Lancement

```bash
npm start
```

## Fonctionnement

1. Au démarrage, le bot se connecte au gateway Discord et bump immédiatement
2. Il attend la confirmation de Disboard dans le channel
3. Dès que Disboard confirme, il programme le prochain bump 2h plus tard
4. En cas d'échec, il réessaie automatiquement dans 5 minutes
5. La connexion se rétablit automatiquement si elle est perdue
