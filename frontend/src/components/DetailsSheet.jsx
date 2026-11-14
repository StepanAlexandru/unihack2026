import { ChevronUp, Landmark, History, Sparkles } from 'lucide-react';
import { DETAIL_ICONS } from './detailMeta.js';
import { STRINGS, styleName } from '../i18n.js';

export default function DetailsSheet({ result, lang, open, setOpen, selectedId, onSelect }) {
  if (!result) return null;
  const t = STRINGS[lang];
  const n = result.narration;
  return (
    <section className={`sheet ${open ? 'open' : ''}`} aria-label={t.details}>
      <button type="button" className="sheet-handle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grabber" />
        <span className="sheet-peek">
          <strong>{n.building_name || styleName(result.style, lang)}</strong>
          <span>
            {t.details} · {result.details.length}
          </span>
        </span>
        <ChevronUp size={18} className="sheet-chev" />
      </button>

      <div className="sheet-body">
        <div className="sheet-grid">
          <div className="kv">
            <span className="k">{t.style}</span>
            <span className="v">
              {styleName(result.style, lang)} <small>· {Math.round(result.confidence * 100)}% {t.confidence}</small>
            </span>
          </div>
          {n.building_name && (
            <div className="kv">
              <span className="k">{t.building}</span>
              <span className="v">{n.building_name}</span>
            </div>
          )}
        </div>

        <h3>
          <History size={15} /> {t.history}
        </h3>
        <p>{n.history}</p>
        <h3>
          <Sparkles size={15} /> {t.why}
        </h3>
        <p>{n.why_it_matters}</p>

        <h3>
          <Landmark size={15} /> {t.detected}
        </h3>
        {result.details.length === 0 ? (
          <p className="muted">{t.noDetails}</p>
        ) : (
          <>
            <p className="muted small">{t.tapHighlight}</p>
            <ul className="detail-list">
              {result.details.map((d) => {
                const Icon = DETAIL_ICONS[d.type] ?? DETAIL_ICONS.architectural_element;
                const sel = d.id === selectedId;
                return (
                  <li key={d.id}>
                    <button type="button" className={`detail-card ${sel ? 'selected' : ''}`} onClick={() => onSelect(sel ? null : d.id)}>
                      <span className="detail-icon">
                        <Icon size={18} />
                      </span>
                      <span className="detail-main">
                        <span className="detail-type">{t.types[d.type] ?? d.type}</span>
                        <span className="detail-label">{d.label}</span>
                        {d.raw_text && (
                          <span className="detail-text">
                            <span>
                              <em>{t.original}:</em> “{d.raw_text}”
                            </span>
                            {d.translated_text && (
                              <span>
                                <em>{t.translation}:</em> {d.translated_text}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
