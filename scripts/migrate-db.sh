#!/bin/bash

# Migration base de données : ajoute 4 colonnes à la table games
# - player1_type, player2_type, winner_type (type de joueur: user/local)
# - duration (durée de la partie en secondes)

# Vérifier que le conteneur est démarré
if ! docker ps | grep -q "ft_transcendence-gateway-1"; then
    echo "❌ Gateway container not running. Start with 'make up' first."
    exit 1
fi

# Vérifier si la migration est déjà faite (4 colonnes doivent exister)
COLUMNS_EXIST=$(docker exec ft_transcendence-gateway-1 sqlite3 /data/app.sqlite "PRAGMA table_info(games);" | grep -c -E "player1_type|player2_type|winner_type|duration")

if [ "$COLUMNS_EXIST" -eq 4 ]; then
    exit 0  # Migration déjà appliquée, on quitte en silence
fi

# Backup de sécurité avant modification
docker cp ft_transcendence-gateway-1:/data/app.sqlite ./backup-before-migration-$(date +%Y%m%d-%H%M%S).sqlite 2>/dev/null

# Appliquer la migration (ajouter les 4 colonnes)
docker exec ft_transcendence-gateway-1 sqlite3 /data/app.sqlite << 'EOF' 2>/dev/null
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
ALTER TABLE games ADD COLUMN player1_type TEXT DEFAULT 'user';
ALTER TABLE games ADD COLUMN player2_type TEXT DEFAULT 'user';
ALTER TABLE games ADD COLUMN winner_type TEXT;
ALTER TABLE games ADD COLUMN duration INTEGER DEFAULT 0;
COMMIT;
PRAGMA foreign_keys=ON;
EOF

# Vérifier que la migration a réussi
FINAL_CHECK=$(docker exec ft_transcendence-gateway-1 sqlite3 /data/app.sqlite "PRAGMA table_info(games);" | grep -c -E "player1_type|player2_type|winner_type|duration")

if [ "$FINAL_CHECK" -ne 4 ]; then
    echo "❌ Migration failed! Expected 4 new columns, found $FINAL_CHECK"
    exit 1
fi

# Redémarrer le gateway pour prendre en compte les changements
docker restart ft_transcendence-gateway-1 > /dev/null 2>&1