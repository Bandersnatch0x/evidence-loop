import {
  BookOpenCheck,
  CalendarClock,
  ClipboardList,
  GraduationCap,
  Grid3x3,
  Menu,
  NotebookPen,
  ShieldCheck,
  Target,
  UsersRound,
  X
} from 'lucide-react'
import type { DemoRole } from '../../shared/contracts'
import { DEMO_ROLE_OPTIONS } from '../lib/demoRole'

export type AppView =
  | 'workspace'
  | 'practice'
  | 'mastery'
  | 'review'
  | 'teaching'
  | 'cohort'
  | 'cohort-mastery'
  | 'transparency'

interface SidebarProps {
  activeView: AppView
  isOpen: boolean
  demoRole: DemoRole
  onNavigate: (view: AppView) => void
  onDemoRoleChange: (role: DemoRole) => void
  onClose: () => void
}

interface NavItem {
  id: AppView
  label: string
  icon: typeof BookOpenCheck
  /** Roles allowed to see the tab; omit for all roles. */
  roles?: DemoRole[]
}

const navigation = [
  { id: 'workspace', label: '学习工作台', icon: BookOpenCheck },
  { id: 'practice', label: '我的练习', icon: NotebookPen, roles: ['student'] },
  { id: 'mastery', label: '我的掌握度', icon: Target, roles: ['student'] },
  { id: 'review', label: '今日复习', icon: CalendarClock, roles: ['student'] },
  {
    id: 'teaching',
    label: '教师工作台',
    icon: ClipboardList,
    roles: ['teacher', 'admin']
  },
  { id: 'cohort', label: '班级学情', icon: UsersRound, roles: ['teacher', 'admin'] },
  {
    id: 'cohort-mastery',
    label: '班级掌握度矩阵',
    icon: Grid3x3,
    roles: ['teacher', 'admin']
  },
  { id: 'transparency', label: '项目透明度', icon: ShieldCheck }
] satisfies NavItem[]

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
        <strong>循证环</strong>
      </div>
      <span className="mobile-status" aria-label="系统在线" />
    </header>
  )
}

export function Sidebar({
  activeView,
  isOpen,
  demoRole,
  onNavigate,
  onDemoRoleChange,
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
            <strong>循证环</strong>
            <span>EvidenceRing · 循证实训</span>
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

        <label className="role-switcher">
          <span>演示角色</span>
          <select
            aria-label="演示角色切换"
            value={demoRole}
            onChange={(event) => {
              const next = event.target.value
              if (next === 'student' || next === 'teacher' || next === 'admin') {
                onDemoRoleChange(next)
              }
            }}
          >
            {DEMO_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small>Demo 假多租户 · 无真实身份认证</small>
        </label>

        <nav className="primary-nav" aria-label="主导航">
          {navigation
            .filter((item) =>
              item.roles === undefined
                ? true
                : item.roles.some((role) => role === demoRole)
            )
            .map(({ id, label, icon: Icon }) => (
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
