const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <h1 class="text-2xl font-bold text-center">Hello Pong 🎮</h1>
    <button id="playBtn" class="bg-blue-500 text-white px-4 py-2 rounded mt-4">
      Jouer
    </button>
  `;
}

document.querySelector("#playBtn")?.addEventListener("click", () => {
  alert("Partie lancée !");
});
