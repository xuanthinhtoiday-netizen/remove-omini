import { CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrushStudio } from './components/BrushStudio';
import { ImageTunerStudio } from './components/ImageTunerStudio';
import { TopBar, type AppTab } from './components/TopBar';
import { VideoStudio } from './components/VideoStudio';

function getInitialTab(): AppTab {
  const hash = (window.location.hash || '').toLowerCase();
  if (hash === '#video' || hash === '#panel-video') return 'video';
  if (hash === '#brush') return 'brush';
  return 'image';
}

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(getInitialTab);
  const [externalFiles, setExternalFiles] = useState<File[]>([]);
  const [imageCount, setImageCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  // Sync #video / #brush hash navigation
  useEffect(() => {
    const onHash = () => setActiveTab(getInitialTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handleTabChange = useCallback((tab: AppTab) => {
    setActiveTab(tab);
    try {
      const nextHash = tab === 'video' ? '#video' : tab === 'brush' ? '#brush' : '';
      window.history.replaceState(null, '', window.location.pathname + window.location.search + nextHash);
    } catch {
      // ignore
    }
  }, []);

  // Ctrl+V paste images directly into Image Tuner Studio
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        setActiveTab('image');
        setExternalFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const clearExternalFiles = useCallback(() => setExternalFiles([]), []);

  const themeClass =
    activeTab === 'video' ? 'theme-video' : activeTab === 'brush' ? 'theme-brush' : 'theme-gemini';

  return (
    <div className={`app-shell ${themeClass}`}>
      <div className="ambient-bg" aria-hidden="true">
        <div className="ambient-orb ambient-orb-1" />
        <div className="ambient-orb ambient-orb-2" />
        <div className="ambient-orb ambient-orb-3" />
        <div className="ambient-grid" />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) {
            setActiveTab('image');
            setExternalFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />

      <TopBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onUploadClick={() => fileInputRef.current?.click()}
        imageCount={imageCount}
      />

      <main className="workspace-main">
        {activeTab === 'image' && (
          <ImageTunerStudio
            externalFiles={externalFiles}
            onClearExternalFiles={clearExternalFiles}
            onImageCountChange={setImageCount}
            onNotify={notify}
          />
        )}

        {activeTab === 'video' && <VideoStudio onNotify={notify} />}

        {activeTab === 'brush' && <BrushStudio onNotify={notify} />}
      </main>

      {toast && (
        <div className="toast-banner" role="status">
          <CheckCircle2 size={16} color="#34d399" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export default App;
