import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RANKS, totalXpToReach } from './engine/progression';
import './styles.css';

// P0 shell: proves the engine is wired into the app. Real screens arrive in later phases.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="panel">
      <h1>SYSTEM</h1>
      <p>PLAYER AWAKENING: not yet implemented (phase P6).</p>
      <table><thead><tr><th>Rank</th><th>Level</th><th>Total XP</th></tr></thead><tbody>
        {RANKS.map((r) => (<tr key={r.rank}><td>{r.rank}</td><td>{r.level}</td><td>{totalXpToReach(r.level).toLocaleString()}</td></tr>))}
      </tbody></table>
    </main>
  </StrictMode>,
);
