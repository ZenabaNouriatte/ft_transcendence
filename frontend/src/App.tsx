import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

/** Envoie une visite au backend avec le type (navigate|reload). */
function sendVisit(type: "navigate" | "reload") {
  fetch("/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Nav-Type": type },
    body: JSON.stringify({ path: location.pathname }),
  }).catch(() => {});
}

/**
 * Compte UNE fois par vrai chargement d’onglet :
 * - navigate / reload -> +1
 * - back/forward (BFCache) -> ne compte pas
 * - navigation SPA -> ne compte pas (pas d’événement pageshow)
 */
function useCountVisitOnceInline() {
  useEffect(() => {
    let type: string | undefined;
    try {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav?.type) type = nav.type; // "navigate" | "reload" | "back_forward" | "prerender"
      // Fallback ultra-vieux navigateurs
      // @ts-ignore
      else if (performance.navigation?.type === 1) type = "reload";
      // @ts-ignore
      else if (performance.navigation?.type === 2) type = "back_forward";
      else type = "navigate";
    } catch {
      type = "navigate";
    }

    if (type === "navigate" || type === "reload") {
      sendVisit(type);
    }
  }, []);
}

function Home() {
  const [api, setApi] = useState<string>("(loading)");
  const [visits, setVisits] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Ping d'un module existant (users)
  useEffect(() => {
    fetch("/api/users/ping")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setApi(JSON.stringify(d)))
      .catch(() => setApi("(error)"));
  }, []);

  // Lecture du total (n'incrémente pas)
useEffect(() => {
  // existing GET
  fetch("/api/visits")
    .then(r => r.json())
    .then(d => setVisits(d?.total ?? 0))
    .catch(e => setError(`visit read error: ${e}`));

  // re-check after the POST likely finished
  const t = setTimeout(() => {
    fetch("/api/visits")
      .then(r => r.json())
      .then(d => setVisits(d?.total ?? 0))
      .catch(() => {});
  }, 400);

  return () => clearTimeout(t);
}, []);

  // Bouton test : simule un vrai "navigate"
  const increment = () =>
  fetch("/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Nav-Type": "navigate" },
    body: JSON.stringify({ path: location.pathname }),
  })
  .then(r => r.json())
  .then(d => setVisits(d.total))
  .catch(e => setError(`visit post error: ${e}`));

  return (
    <section>
      <h1>ft_transcendence (React + TS)</h1>

      <p>
        API test: <code>/api/users/ping</code> → <b>{api}</b>
      </p>

      <p>
        Visites totales : <b>{visits}</b>{" "}
        <button onClick={increment} style={{ marginLeft: 8 }}>
          +1 (test)
        </button>
      </p>

      {error && (
        <p style={{ color: "crimson" }}>
          {error} — vérifie <code>POST /api/visit</code> et <code>GET /api/visits</code>.
        </p>
      )}
    </section>
  );
}

function About() {
  return (
    <section>
      <h1>About</h1>
      <p>Page de test pour valider la navigation Back/Forward.</p>
    </section>
  );
}

export default function App() {
  // Compte 1x au vrai chargement (navigate/reload), pas sur BFCache/SPAs
  useCountVisitOnceInline();

  return (
    <BrowserRouter>
      <nav style={{ display: "flex", gap: 16, padding: 16 }}>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>

      <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

