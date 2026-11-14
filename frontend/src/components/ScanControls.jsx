import { Camera, ChevronLeft, ChevronRight, ImageUp, ScanLine, Radar } from 'lucide-react';
import { STRINGS } from '../i18n.js';

function UploadInput({ onUpload }) {
  return (
    <input
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onUpload(f);
      }}
    />
  );
}

export default function ScanControls({
  lang,
  scanning,
  liveScan,
  setLiveScan,
  onScan,
  fallback,
  sampleName,
  onPrevSample,
  onNextSample,
  onUpload,
  onUseCamera,
}) {
  const t = STRINGS[lang];
  return (
    <div className="controls">
      <div className="side left">
        <button type="button" className={`toggle ${liveScan ? 'on' : ''}`} onClick={() => setLiveScan(!liveScan)} aria-pressed={liveScan}>
          <Radar size={16} />
          <span>{t.liveScan}</span>
          <span className="switch">
            <span />
          </span>
        </button>
      </div>

      <button type="button" className={`shutter ${scanning ? 'busy' : ''}`} onClick={onScan} aria-label={t.scan}>
        <span className="shutter-ring" />
        <ScanLine size={28} />
      </button>

      <div className="side right">
        {fallback ? (
          <div className="sample-nav">
            <button type="button" className="icon-btn" onClick={onPrevSample} aria-label="Previous sample">
              <ChevronLeft size={18} />
            </button>
            <span className="sample-name">{sampleName}</span>
            <button type="button" className="icon-btn" onClick={onNextSample} aria-label="Next sample">
              <ChevronRight size={18} />
            </button>
            <label className="icon-btn" aria-label={t.upload} title={t.upload}>
              <ImageUp size={18} />
              <UploadInput onUpload={onUpload} />
            </label>
            {onUseCamera && (
              <button type="button" className="icon-btn" onClick={onUseCamera} aria-label={t.useCamera} title={t.useCamera}>
                <Camera size={18} />
              </button>
            )}
          </div>
        ) : (
          // Live camera: let laptop users analyse a photo of a building instead of the webcam.
          <label className="toggle upload-pill" title={t.upload}>
            <ImageUp size={16} />
            <span>{t.upload}</span>
            <UploadInput onUpload={onUpload} />
          </label>
        )}
      </div>
    </div>
  );
}
