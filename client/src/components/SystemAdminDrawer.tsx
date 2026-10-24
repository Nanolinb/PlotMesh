import AdminPanel from './AdminPanel';

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function SystemAdminDrawer({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10020,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'var(--bg-overlay)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        aria-label="系统管理"
        style={{
          width: 760,
          maxWidth: '96vw',
          height: '100%',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            flexShrink: 0,
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>系统管理</div>
            <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-muted)' }}>
              用户、项目成员池、服务设置与引用审计
            </div>
          </div>
          <button
            onClick={onClose}
            title="关闭系统管理"
            style={{
              padding: 4,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 18,
            }}
          >
            ✕
          </button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 16 }}>
          <AdminPanel />
        </div>
      </section>
    </div>
  );
}
