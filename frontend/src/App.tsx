import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";


function Home() {
  const [api, setApi] = useState<string>("(loading)");

  useEffect(() => {
    fetch("/api/ping")
      .then(r => r.json())
      .then(d => setApi(JSON.stringify(d)))
      .catch(() => setApi("(error)"));
  }, []);

  return (
    <section>
      <h1>ft_transcendence (React + TS)</h1>
      <p>
        API test: <code>/api/ping</code> → <b>{api}</b>
      </p>
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