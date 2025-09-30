// backend/src/common/security.ts
import bcrypt from "bcrypt";

// nombre de rounds : 12 = bon compromis perf/sécurité
const ROUNDS = 12;

export async function hashPassword(plain: string) {
  // bcrypt génère un salt unique et le stocke dans le hash
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(hash: string, plain: string) {
  return bcrypt.compare(plain, hash);
}

// Utile si tu dois échapper côté backend (logs, templates…)
export function escapeHTML(s: string) {
  return s.replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]!));
}
