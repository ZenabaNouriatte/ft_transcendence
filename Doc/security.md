# Architecture de sécurité

# Username : Longueur : 3 à 20 caractères maximum

Caractères autorisés :

Lettres : a-z A-Z
Chiffres : 0-9
Tirets : - et _ (underscore)

Caractères interdits :
Espaces
Caractères spéciaux : @, ., !, #, $, etc.
Accents



## Authentification
- JWT avec expiration 24h
- Tokens validés côté microservice `svc-auth`
- bcrypt avec cost factor 10

## Protection des données
- Passwords jamais exposés dans les réponses API
- Requêtes SQL paramétrées (prévention injection)
- Sanitization XSS via bibliothèque `xss`

## Transport sécurisé
- HTTPS/TLS en production (nginx reverse proxy)
- WebSocket sur WSS uniquement
- Headers CSP, X-Frame-Options, X-Content-Type-Options

## Validation entrées
- Username: 3-20 caractères alphanumériques
- Email: format RFC validé
- Password: 8+ caractères, doit contenir lettres + chiffres

## Rate limiting
- 100 requêtes/minute par IP
- Protection contre brute force sur login