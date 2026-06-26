import { useState } from 'react';
import { api } from '../lib/invoke';
import type { Concours, FormatEquipe } from '../lib/types';

interface Props {
  onCree: (c: Concours) => void;
  onAnnuler: () => void;
}

export default function CreerConcours({ onCree, onAnnuler }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [nom, setNom] = useState('');
  const [date, setDate] = useState(today);
  const [format, setFormat] = useState<FormatEquipe>('doublette');
  const [nbTours, setNbTours] = useState(4);
  const [erreur, setErreur] = useState('');
  const [loading, setLoading] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim()) { setErreur('Le nom du concours est obligatoire.'); return; }
    setErreur('');
    setLoading(true);
    try {
      const c = await api.creerConcours({
        nom: nom.trim(),
        date,
        formatEquipe: format,
        nbTours: nbTours,
        antiClubTour1: false,
        regleExempte: 'score_fictif',
      });
      onCree(c);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Nouveau concours</h1>
        <p>Configurez les paramètres avant d'inscrire les équipes.</p>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        {erreur && <div className="alert alert-err">{erreur}</div>}

        <form onSubmit={soumettre}>
          <div className="form-group">
            <label>Nom du concours</label>
            <input
              value={nom}
              onChange={e => setNom(e.target.value)}
              placeholder="Ex : Tournoi du 14 juillet"
              autoFocus
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Nombre de tours</label>
              <select value={nbTours} onChange={e => setNbTours(Number(e.target.value))}>
                <option value={3}>3 tours</option>
                <option value={4}>4 tours</option>
                <option value={5}>5 tours</option>
                <option value={6}>6 tours</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>Format des équipes</label>
            <select value={format} onChange={e => setFormat(e.target.value as FormatEquipe)}>
              <option value="tete_a_tete">Tête-à-tête (1 joueur)</option>
              <option value="doublette">Doublette (2 joueurs)</option>
              <option value="triplette">Triplette (3 joueurs)</option>
            </select>
          </div>

          <div className="flex-row">
            <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
              {loading ? 'Création…' : 'Créer le concours'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onAnnuler}>
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
