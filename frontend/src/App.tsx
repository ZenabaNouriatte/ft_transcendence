import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";

/**
 * Incrémente le compteur UNE SEULE FOIS au vrai chargement de l’onglet :
 * - navigate / reload  -> +1
 * - back_forward       -> pas d’incrément
 * Le ref évite le double run en dev (React StrictMode).
 */
function useIncrementOnRealLoad() {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // Détection du type de navigation (API moderne)
    let navType: "navigate" | "reload" | "back_forward" | "prerender" | "unknown" = "unknown";
    try {
      const entries = performance.getEntriesByType?.("navigation") as PerformanceNavigationTiming[] | undefined;
      if (entries && entries.length) {
        navType = entries[0].type;
      } else {
        // Fallback (API dépréciée) pour certains navigateurs
        const legacy: any = (performance as any).navigation;
        if (legacy) {
          // 0: TYPE_NAVIGATE, 1: TYPE_RELOAD, 2: TYPE_BACK_FORWARD
          if (legacy.type === 0) navType = "navigate";
          else if (legacy.type === 1) navType = "reload";
          else if (legacy.type === 2) navType = "back_forward";
        }
      }
    } catch {
      navType = "unknown";
    }

    if (navType === "navigate" || navType === "reload" || navType === "unknown") {
      // unknown -> on préfère compter plutôt que rater une visite
      fetch("/api/visit", { method: "POST" }).catch(() => {});
    }
  }, []);
}

function Home() {
  const [api, setApi] = useState<string>("(loading)");
  const [visits, setVisits] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Ping de l'API pour la démo
  useEffect(() => {
    fetch("/api/ping")
      .then((r) => r.json())
      .then((d) => setApi(JSON.stringify(d)))
      .catch(() => setApi("(error)"));
  }, []);

  // Lecture du total (n'incrémente pas)
  useEffect(() => {
    fetch("/api/visits")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setVisits((d?.total as number) ?? 0))
      .catch((e) => setError(`visit read error: ${e}`));
  }, []);

  // Bouton pour tester l'incrément manuellement
  const increment = () =>
    fetch("/api/visit", { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setVisits((d?.total as number) ?? 0))
      .catch((e) => setError(`visit post error: ${e}`));

  return (
    <section>
      <h1>ft_transcendence (React + TS)</h1>

      <p>
        API test: <code>/api/ping</code> → <b>{api}</b>
      </p>

      <p>
        Visites totales (DB): <b>{visits}</b>{" "}
        <button onClick={increment} style={{ marginLeft: 8 }}>
          +1 (test)
        </button>
      </p>

      {error && (
        <p style={{ color: "crimson" }}>
          {error} — vérifie que les routes <code>POST /api/visit</code> et <code>GET /api/visits</code> sont bien exposées.
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
  // Incrémente au vrai chargement (navigate/reload), pas sur back/forward
  useIncrementOnRealLoad();

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
