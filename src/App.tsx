import { useEffect, useState } from 'react';
import './App.css';
import type { Concours } from './lib/types';
import { FORMAT_LABEL } from './lib/types';
import { api } from './lib/invoke';

import Accueil from './screens/Accueil';
import CreerConcours from './screens/CreerConcours';
import Inscription from './screens/Inscription';
import Tirage from './screens/Tirage';
import Saisie from './screens/Saisie';
import Classement from './screens/Classement';
import Recherche from './screens/Recherche';

type Screen = 'accueil' | 'creer' | 'inscription' | 'tirage' | 'saisie' | 'classement' | 'recherche';

export default function App() {
  const [concours, setConcours] = useState<Concours | null>(null);
  const [screen, setScreen] = useState<Screen>('accueil');
  const [saisirTourId, setSaisirTourId] = useState<number | null>(null);
  const [toursDrawn, setToursDrawn] = useState(0);

  useEffect(() => {
    document.title = concours ? `${concours.nom} — Pétanque` : 'Concours de Pétanque';
  }, [concours]);

  async function ouvrirConcours(c: Concours) {
    setConcours(c);
    try {
      const ts = await api.listTours();
      const drawn = ts.filter(t => t.statut !== 'en_attente').length;
      setToursDrawn(drawn);
      setScreen(drawn > 0 ? 'tirage' : 'inscription');
    } catch {
      setToursDrawn(0);
      setScreen('inscription');
    }
  }

  function allerSaisir(tourId: number) {
    setSaisirTourId(tourId);
    setScreen('saisie');
  }

  function onTourTire() {
    setToursDrawn(prev => prev + 1);
    setScreen('tirage');
  }

  function tourSuivantTire() {
    setToursDrawn(prev => prev + 1);
    setScreen('tirage');
  }

  const navTabs: { key: Screen; label: string }[] = concours
    ? [
        { key: 'inscription', label: 'Équipes' },
        ...(toursDrawn > 0
          ? [
              { key: 'tirage' as Screen,     label: 'Rencontres' },
              { key: 'saisie' as Screen,     label: 'Saisie' },
              { key: 'classement' as Screen, label: 'Classement' },
              { key: 'recherche' as Screen,  label: 'Recherche' },
            ]
          : []),
      ]
    : [];

  return (
    <div className="app">
      <nav className="nav">
        <span
          className="nav-title"
          style={{ cursor: concours ? 'default' : 'pointer' }}
          onClick={() => !concours && setScreen('accueil')}
        >
          {concours ? concours.nom : 'Pétanque'}
        </span>

        <div className="nav-tabs">
          {navTabs.map(t => (
            <button
              key={t.key}
              className={`nav-tab ${screen === t.key ? 'active' : ''}`}
              onClick={() => setScreen(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {concours && (
          <div className="nav-right">
            <span className="text-sm" style={{ color: 'rgba(255,255,255,.6)' }}>
              {concours.date} · {FORMAT_LABEL[concours.format_equipe]}
              {toursDrawn > 0 && ` · Tour ${toursDrawn}/${concours.nb_tours}`}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: 'rgba(255,255,255,.8)', borderColor: 'rgba(255,255,255,.3)' }}
              onClick={() => { setConcours(null); setScreen('accueil'); setToursDrawn(0); }}
            >
              ✕ Fermer
            </button>
          </div>
        )}
      </nav>

      {screen === 'accueil' && (
        <Accueil onConcours={ouvrirConcours} onCreer={() => setScreen('creer')} />
      )}
      {screen === 'creer' && (
        <CreerConcours onCree={ouvrirConcours} onAnnuler={() => setScreen('accueil')} />
      )}
      {screen === 'inscription' && concours && (
        <Inscription concours={concours} onTourTire={onTourTire} />
      )}
      {screen === 'tirage' && concours && (
        <Tirage concours={concours} onSaisir={allerSaisir} />
      )}
      {screen === 'saisie' && concours && (
        <Saisie
          tourId={saisirTourId}
          concours={concours}
          onTourSuivantTire={tourSuivantTire}
        />
      )}
      {screen === 'classement' && <Classement />}
      {screen === 'recherche' && <Recherche />}
    </div>
  );
}
