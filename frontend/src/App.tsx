import { useEffect, useState } from "react";

export default function App() {
  const [api, setApi] = useState<string>("(loading)");

  useEffect(() => {
    fetch("/api/ping")
      .then(r => r.json())
      .then(d => setApi(JSON.stringify(d)))
      .catch(() => setApi("(error)"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>ft_transcendence (React + TS)</h1>
      <p>
        API test: <code>/api/ping</code> → <b>{api}</b>
      </p>
    </main>
  );
}
