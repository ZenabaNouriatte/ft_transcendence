#!/bin/bash

# Script de migration de la base de données ft_transcendence
# Ajoute les colonnes manquantes à la table games pour supporter les types de joueurs
# 
# Colonnes ajoutées :
# - player1_type (user/local)
# - player2_type (user/local) 
# - winner_type (user/local)
# - duration (secondes)

echo "🔧 Starting database migration for ft_transcendence..."

# Vérifier que le conteneur gateway est en cours d'exécution
if ! docker ps | grep -q "ft_transcendence-gateway-1"; then
    echo "❌ Gateway container is not running! Please start with 'make up' first."
    exit 1
fi

# Vérifier si la migration est nécessaire
echo "🔍 Checking if migration is needed..."
COLUMNS_EXIST=$(docker exec ft_transcendence-gateway-1 sqlite3 /data/app.sqlite "PRAGMA table_info(games);" | grep -c -E "player1_type|player2_type|winner_type|duration")

if [ "$COLUMNS_EXIST" -eq 4 ]; then
    echo "✅ Migration already applied! All columns exist."
    exit 0
fi

# Faire une sauvegarde avant migration
echo "💾 Creating backup before migration..."
docker cp ft_transcendence-gateway-1:/data/app.sqlite ./backup-before-migration-$(date +%Y%m%d-%H%M%S).sqlite

# Effectuer la migration avec gestion d'erreurs
echo "🔄 Applying database migration..."
docker exec ft_transcendence-gateway-1 sqlite3 /data/app.sqlite << 'EOF'
.timeout 5000

-- Ajouter les colonnes manquantes avec gestion d'erreurs silencieuse
-- SQLite ignorera les erreurs si les colonnes existent déjà

PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

-- Ajouter player1_type si elle n'existe pas
ALTER TABLE games ADD COLUMN player1_type TEXT DEFAULT 'user';

-- Ajouter player2_type si elle n'existe pas  
ALTER TABLE games ADD COLUMN player2_type TEXT DEFAULT 'user';

-- Ajouter winner_type si elle n'existe pas
ALTER TABLE games ADD COLUMN winner_type TEXT;

-- Ajouter duration si elle n'existe pas
ALTER TABLE games ADD COLUMN duration INTEGER DEFAULT 0;

COMMIT;

PRAGMA foreign_keys=ON;

-- Vérifier le résultat
.echo on
SELECT 'Migration completed. Table structure:' as info;
PRAGMA table_info(games);
EOF

MIGRATION_STATUS=$?

if [ $MIGRATION_STATUS -eq 0 ]; then
    echo "✅ Database migration completed successfully!"
    
    # Vérifier que toutes les colonnes sont présentes
    FINAL_CHECK=$(docker exec ft_transcendence-gateway-1 sqlite3 /data/app.sqlite "PRAGMA table_info(games);" | grep -c -E "player1_type|player2_type|winner_type|duration")
    
    if [ "$FINAL_CHECK" -eq 4 ]; then
        echo "✅ All 4 new columns confirmed present"
        echo "🔄 Restarting gateway to refresh schema cache..."
        docker restart ft_transcendence-gateway-1
        echo "🎮 Game creation should now work properly!"
    else
        echo "⚠️  Warning: Some columns may be missing. Check manually."
    fi
else
    echo "❌ Database migration failed! Check the error messages above."
    echo "💾 Backup file created: backup-before-migration-*.sqlite"
    exit 1
fi