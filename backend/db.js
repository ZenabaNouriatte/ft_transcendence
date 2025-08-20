const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Chemin DB : variable d'env ou /app/data/app.sqlite par défaut
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.sqlite');

// Ouvre (ou crée) la DB
const db = new sqlite3.Database(DB_PATH);

// Crée la table si elle n'existe pas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL
  )`);
});

// Ajoute une visite (INSERT)
function addVisit() {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO visits (ts) VALUES (datetime('now'))`,
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

// Compte les visites (SELECT COUNT)
function countVisits() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) AS cnt FROM visits`, (err, row) => {
      if (err) return reject(err);
      resolve(row.cnt);
    });
  });
}

module.exports = { addVisit, countVisits, DB_PATH };
