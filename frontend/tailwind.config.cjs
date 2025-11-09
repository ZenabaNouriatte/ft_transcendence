// CONFIGURATION DE TAILWIND CSS

// Permet d'avoir l'autocomplétion dans vscode
/** @type {import('tailwindcss').Config} */

module.exports = {
  // Liste des fichiers à scanner pour trouver les classes Tailwind utilisées
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],

  // Normalement pour personnaliser le thème Tailwind (couleurs, polices, etc)
  // Ici on garde les valeurs par défaut
  theme: { extend: {} },

  // Pas de plugins utilisés
  plugins: [],
};
