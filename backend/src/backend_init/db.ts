import sqlite3 from 'sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration de la base de données
const DB_PATH = join(__dirname, '..', 'database.sqlite');
const SCHEMA_PATH = join(__dirname, '..', 'src', 'schema.sql');

class Database {
    private static instance: Database;
    private db: sqlite3.Database;

    private constructor() {
        // Créer la base de données SQLite
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Erreur lors de l\'ouverture de la base de données:', err.message);
            } else {
                console.log('Connexion à la base de données SQLite établie.');
                this.initializeDatabase();
            }
        });

        // Activer les clés étrangères
        this.db.run('PRAGMA foreign_keys = ON');
    }

    public static getInstance(): Database {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    private initializeDatabase(): void {
        try {
            const schema = readFileSync(SCHEMA_PATH, 'utf8');
            this.db.exec(schema, (err) => {
                if (err) {
                    console.error('Erreur lors de l\'initialisation du schéma:', err.message);
                } else {
                    console.log('Schéma de base de données initialisé avec succès.');
                }
            });
        } catch (error) {
            console.error('Erreur lors de la lecture du fichier schema.sql:', error);
        }
    }

    // Méthode utilitaire pour exécuter des requêtes
    public run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this);
                }
            });
        });
    }

    // Méthode pour récupérer une seule ligne
    public get(sql: string, params: any[] = []): Promise<any> {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Méthode pour récupérer toutes les lignes
    public all(sql: string, params: any[] = []): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Fermer la connexion
    public close(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('Connexion à la base de données fermée.');
                    resolve();
                }
            });
        });
    }

    // Obtenir l'instance de la base de données directe (pour des cas spéciaux)
    public getDatabase(): sqlite3.Database {
        return this.db;
    }
}

// Exporter l'instance singleton
export const db = Database.getInstance();

// Fonctions de gestion de la connexion pour compatibilité
export async function connectDB() {
    console.log('✅ Base de données SQLite prête');
}

export async function disconnectDB() {
    try {
        await db.close();
        console.log('✅ Déconnexion de la base de données SQLite réussie');
    } catch (error) {
        console.error('❌ Erreur lors de la déconnexion:', error);
    }
}

// Gestion propre de l'arrêt de l'application
process.on('beforeExit', async () => {
    await disconnectDB();
});

process.on('SIGINT', async () => {
    await disconnectDB();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await disconnectDB();
    process.exit(0);
});

export default db;
