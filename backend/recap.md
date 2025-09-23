1. Microservice Auth

Rôle : il s’occupe de la validation des identifiants et du hash de mot de passe.

Ce qu’il fait actuellement :
Quand tu enregistres un utilisateur (/api/users/register depuis le gateway), le gateway envoie la requête à auth pour valider et hasher le mot de passe (/validate-register).
→ Auth retourne le mot de passe hashé, que le gateway enregistre en DB.
Quand tu fais un login (/api/users/login), le gateway demande à auth (/validate-login) si le mot de passe fourni correspond au hash en DB.
→ Auth dit “ok” ou “pas ok”, et le gateway génère un petit token interne (base64 userId+timestamp).

👉 Conclusion : Auth n’écrit jamais en base, il fait juste la sécurité côté passwords.

2. Microservice Game

Rôle : il valide la logique métier d’une partie.

Endpoints internes :
/validate-game-creation : vérifie qu’un joueur peut créer une partie (pas contre lui-même, etc.), et renvoie un “state” cohérent (player1, player2=null, status=waiting).
/validate-game-join : vérifie qu’un joueur peut rejoindre une partie en attente (pas son propre game, pas déjà plein, etc.).
/validate-score-update : vérifie que la MAJ des scores est légale (scores ≥ 0, partie en cours, etc.).
/validate-game-finish : vérifie qu’on peut terminer une partie (que le gagnant est bien un des joueurs, partie en cours).

👉 Conclusion : Game ne touche pas la base non plus, il agit comme juge des règles de création/join/score/fin de partie.

3. Gateway

C’est lui qui :

Expose les vraies routes publiques (/api/users/*, /api/games/*).
Parle aux microservices (auth, game, …) pour validation.
Écrit en DB (users, games, stats, …) seulement après validation par le MS.

4. Exemple de flow
🆕 Enregistrement

POST /api/users/register (gateway)
Gateway appelle Auth /validate-register.
Auth renvoie le mot de passe hashé.
Gateway insère l’utilisateur en DB.

🔑 Login

POST /api/users/login
Gateway récupère user+hash en DB.
Gateway appelle Auth /validate-login avec (password, hash).
Auth valide.
Gateway génère un token et le renvoie.

🎮 Création de partie

POST /api/games avec token.
Gateway appelle Game /validate-game-creation.
Game renvoie “ok, status=waiting, player2=null”.
Gateway insère la partie en DB.

➕ Join d’une partie

POST /api/games/:id/join avec token.
Gateway récupère la partie en DB et envoie à Game /validate-game-join.
Game valide.
Gateway met à jour la DB (player2_id = bob, status=playing).

⚖️ Architecture logique
Auth : gardien des identifiants.
Game : gardien des règles métier.
Gateway : chef d’orchestre + accès DB.

