// Ouvre la db dans process.env.DB_PATH
// applique le sch au demarrage
// Prepare 2 statememts : get total & increment
// Exporte des helpers pour l'API

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB_PATH = process.env.DB_PATH || "/data/app.sqlite";

/* Garder une unique connexion 
garantir une seule instance de DB pour le process*/
let db: Database.Database | null = null; 
let stmtGet!: Database.Statement; // pour eviter reparse sql a chaque appel 
let stmtInc!: Database.Statement;

/* Charge et execute schema.sql ( creation table + sead de la ligne id=1)
//Usge : structure au demarrage tjs prete*/
function ensureSchema(d: Database.Database) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(__dirname, "schema.sql"); // même dossier que ce fichier
  const sql = fs.readFileSync(schemaPath, "utf8");
  d.exec(sql);
}

/* Ouvrir une seule fois la base, config et prepa des requetes */
export function openDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH); //ouverture synchrone de la base
  db.pragma("journal_mode = WAL"); // mode wal
  db.pragma("busy_timeout = 5000");

  ensureSchema(db); //creationd e la table unique si besoin 

  stmtGet = db.prepare("SELECT count AS total FROM visits_counter WHERE id = 1");
  stmtInc = db.prepare("UPDATE visits_counter SET count = count + 1 WHERE id = 1");
  return db;
}

/* Renvoi le total 
// IpenDB() gantie l'etat
// execute stmtGet.get() renvoi row.total ou 0)
// usage : route GET /api/visits */
export function getVisitTotal(): number {
  openDb();
  const row = stmtGet.get() as { total: number } | undefined;
  return row?.total ?? 0;
}

/* Incremente de 1 et renvoi la nouvelle valeur
// db!.transaction(() => { UPDATE; SELECT; return total; })()
// Garantit qu'on ne lit pas une valeur entre deux si plusieurs requetes arrivent en meme tmp
// usage : route POST /api/visit*/
export function incrementVisit(): number {
  openDb();
  const tx = db!.transaction(() => {
    stmtInc.run();
    const row = stmtGet.get() as { total: number };
    return row.total;
  });
  return tx();
}
