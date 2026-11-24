import { Film, Image as ImageIcon, Paintbrush, Upload } from 'lucide-react';
import React from 'react';

export type AppTab = 'image' | 'video' | 'brush';

interface TopBarProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onUploadClick: () => void;
  imageCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onTabChange,
  onUploadClick,
  imageCount,
}) => {
  const tabs: Array<{ id: AppTab; label: string; sub: string; icon: React.ReactNode }> = [
    {
      id: 'image',
      label: 'Xóa Logo Ảnh',
      sub: 'Gemini · Nano Banana',
      icon: <ImageIcon size={15} />,
    },
    {
      id: 'video',
      label: 'Xóa Logo Video',
      sub: 'Omni · Flow · Veo 3',
      icon: <Film size={15} />,
    },
    {
      id: 'brush',
      label: 'Tẩy Tự Do',
      sub: 'Logo bất kỳ',
      icon: <Paintbrush size={15} />,
    },
  ];

  return (
    <header className="topbar glass-panel">
      <div className="brand-group">
        <div className="brand-icon" aria-hidden="true">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2C12.7 7.4 16.6 11.3 22 12C16.6 12.7 12.7 16.6 12 22C11.3 16.6 7.4 12.7 2 12C7.4 11.3 11.3 7.4 12 2Z"
              fill="white"
            />
          </svg>
        </div>
        <div>
          <div className="brand-title">
            AuraErase
            <span className="brand-badge">PRO · EXACT ALPHA</span>
          </div>
          <div className="brand-sub">Xóa Logo Gemini, Omni, Flow &amp; Veo 3 — 0% giảm chất lượng</div>
        </div>
      </div>

      <nav className="mode-switcher" aria-label="Chọn công cụ">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`mode-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="topbar-actions">
        {activeTab !== 'video' && (
          <button type="button" className="btn btn-ghost" onClick={onUploadClick}>
            <Upload size={15} />
            <span>{imageCount > 0 ? `Thêm ảnh (${imageCount})` : 'Tải ảnh lên'}</span>
          </button>
        )}
      </div>
    </header>
  );
};
