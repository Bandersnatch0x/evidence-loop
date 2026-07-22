import {
  BookOpenCheck,
  GraduationCap,
  Menu,
  ShieldCheck,
  UsersRound,
  X
} from 'lucide-react'

export type AppView = 'workspace' | 'cohort' | 'transparency'

interface SidebarProps {
  activeView: AppView
  isOpen: boolean
  onNavigate: (view: AppView) => void
  onClose: () => void
}

const navigation = [
  { id: 'workspace', label: '学习工作台', icon: BookOpenCheck },
  { id: 'cohort', label: '班级学情', icon: UsersRound },
  { id: 'transparency', label: '项目透明度', icon: ShieldCheck }
] satisfies Array<{
  id: AppView
  label: string
  icon: typeof BookOpenCheck
}>

export function MobileHeader({ onOpen }: { onOpen: () => void }) {
  return (
    <header className="mobile-header">
      <button
        className="icon-button"
        type="button"
        aria-label="打开导航"
        onClick={onOpen}
      >
        <Menu size={20} />
      </button>
      <div className="mobile-brand">
        <GraduationCap size={19} />
        <strong>EvidenceLoop</strong>
      </div>
      <span className="mobile-status" aria-label="系统在线" />
    </header>
  )
}

export function Sidebar({
  activeView,
  isOpen,
  onNavigate,
  onClose
}: SidebarProps) {
  const navigate = (view: AppView) => {
    onNavigate(view)
    onClose()
  }

  return (
    <>
      <button
        className={`sidebar-backdrop ${isOpen ? 'is-visible' : ''}`}
        type="button"
        aria-label="关闭导航"
        tabIndex={isOpen ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`sidebar ${isOpen ? 'is-open' : ''}`}>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <GraduationCap size={22} />
          </div>
          <div>
            <strong>EvidenceLoop</strong>
            <span>循证实训 Agent</span>
          </div>
          <button
            className="sidebar-close"
            type="button"
            aria-label="关闭导航"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>

        <div className="track-label">
          <span className="status-dot" />
          AI+教育赛道 Demo
        </div>

        <nav className="primary-nav" aria-label="主导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={activeView === id ? 'is-active' : ''}
              aria-current={activeView === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span>当前闭环</span>
          <strong>提交 → 证据 → 诊断 → 再验证</strong>
          <p>分数由测试与量规确定，模型不参与改分。</p>
        </div>

        <footer className="sidebar-footer">
          <span>本地演示环境</span>
          <span className="environment-state">运行正常</span>
        </footer>
      </aside>
    </>
  )
}
