import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Receipt, LayoutDashboard, ClipboardList,
  LogOut, Upload, AlertTriangle, Check, X,
  TrendingUp, Wallet, Clock, Search,
  Eye, Download, Settings, Users, RefreshCw, UserPlus, Copy
} from 'lucide-react'
import '../styles.css'
import { scanReceipt } from '../lib/receiptOcr'
import { authClient } from '../lib/auth'

// ──────────────────────────────────────────────
// CSV Export Utility
// ──────────────────────────────────────────────
function exportCSV(expenses: Expense[], filename: string) {
  const STATUS_LABEL: Record<Status, string> = { pending: '審査中', approved: '承認済', rejected: '却下' }
  const header = ['ID', '件名', '金額', '日付', 'カテゴリ', '申請者', 'ステータス', '備考', 'AI警告']
  const rows = expenses.map(e => [
    e.id, e.title, e.amount, e.date, e.category, e.submitterName,
    STATUS_LABEL[e.status], e.note ?? '', e.aiWarning ?? ''
  ])
  const bom = '\uFEFF'
  const csv = bom + [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
type Role = 'member' | 'admin'
interface CurrentUser { id: string; name: string; email: string; role: Role; image?: string | null }
type Category = '食品・飲料' | '装飾・備品' | '印刷・コピー' | '交通費' | '通信費' | 'その他'
type Status = 'pending' | 'approved' | 'rejected'
interface Expense {
  id: string; title: string; amount: number; date: string; category: string
  submitterId: string; submitterName: string; status: Status; note?: string | null
  aiWarning?: string | null; rejectionReason?: string | null; receiptImageKey?: string | null; createdAt: string | number
}
interface Toast { id: string; message: string; type: 'success' | 'error' | 'info'; visible: boolean }
type Tab = 'form' | 'history' | 'admin' | 'dashboard'

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const CATEGORIES: Category[] = ['食品・飲料', '装飾・備品', '印刷・コピー', '交通費', '通信費', 'その他']
const CAT_COLORS = ['#6366F1','#8B5CF6','#EC4899','#14B8A6','#F59E0B','#EF4444']
const CAT_EMOJI: Record<string, string> = {
  '食品・飲料': '🍱', '装飾・備品': '🎀', '印刷・コピー': '🖨️',
  '交通費': '🚃', '通信費': '📡', 'その他': '📦'
}
const STATUS_META: Record<Status, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pending:  { label: '審査中', color: '#D97706', bg: '#FEF3C7', icon: <Clock size={12}/> },
  approved: { label: '承認済', color: '#059669', bg: '#D1FAE5', icon: <Check size={12}/> },
  rejected: { label: '却下',   color: '#DC2626', bg: '#FEE2E2', icon: <X size={12}/> },
}

// ──────────────────────────────────────────────
// Toast Hook
// ──────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(p => [...p, { id, message, type, visible: true }])
    setTimeout(() => setToasts(p => p.map(t => t.id === id ? { ...t, visible: false } : t)), 3200)
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3700)
  }, [])
  return { toasts, show }
}

// ──────────────────────────────────────────────
// Toaster
// ──────────────────────────────────────────────
function Toaster({ toasts }: { toasts: Toast[] }) {
  const bg = { success: '#10B981', error: '#EF4444', info: '#6366F1' }
  return (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, display:'flex', flexDirection:'column', gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: bg[t.type], color: '#fff', padding: '12px 18px',
          borderRadius: 10, fontSize: 14, fontWeight: 500, minWidth: 220,
          boxShadow: '0 4px 20px rgba(0,0,0,.18)',
          opacity: t.visible ? 1 : 0, transform: t.visible ? 'translateX(0)' : 'translateX(40px)',
          transition: 'opacity .4s ease, transform .4s ease'
        }}>{t.message}</div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────
// Login Screen
// ──────────────────────────────────────────────
function LoginScreen() {
  // 招待リンク（?invite=CODE）が付いていれば signup モードで開き、コードを補完
  const initialInvite = new URLSearchParams(window.location.search).get('invite') ?? ''
  const [mode, setMode] = useState<'login' | 'signup'>(initialInvite ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState(initialInvite)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (mode === 'signup') {
        // 招待コードはヘッダーで送り、サーバ側の招待ゲートで検証する
        const res = await authClient.signUp.email(
          { email, password, name },
          { headers: inviteCode ? { 'x-invite-code': inviteCode } : undefined },
        )
        if (res.error) { setError(res.error.message ?? '登録に失敗しました'); setLoading(false); return }
      } else {
        const res = await authClient.signIn.email({ email, password })
        if (res.error) { setError(res.error.message ?? 'ログインに失敗しました'); setLoading(false); return }
      }
      // セッションを確実に反映させるためリロード
      window.location.reload()
    } catch (err: any) {
      setError(err.message ?? 'エラーが発生しました')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }}>
      <div style={{
        background:'#fff', borderRadius:20, padding:'40px 36px', width:'100%', maxWidth:400,
        boxShadow:'0 20px 60px rgba(0,0,0,.2)'
      }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{
            width:56, height:56, borderRadius:14, background:'linear-gradient(135deg,#667eea,#764ba2)',
            display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px'
          }}>
            <Receipt size={28} color="#fff"/>
          </div>
          <h1 style={{ fontSize:22, fontWeight:700, color:'#1E293B', margin:0 }}>精算管理システム</h1>
          <p style={{ color:'#64748B', fontSize:13, marginTop:6 }}>
            {mode === 'login' ? 'アカウントにサインイン' : '新しいアカウントを作成'}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {mode === 'signup' && (
            <>
              <div>
                <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>名前</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)} required
                  placeholder="山田 太郎"
                  style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827', boxSizing:'border-box', outline:'none' }}
                />
              </div>
              <div>
                <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>招待コード</label>
                <input
                  type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value)}
                  placeholder="管理者から受け取った招待コード"
                  style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827', boxSizing:'border-box', outline:'none' }}
                />
                <p style={{ fontSize:11, color:'#94A3B8', marginTop:4 }}>※ 最初の登録者は管理者になります（招待コード不要）</p>
              </div>
            </>
          )}
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>メールアドレス</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              placeholder="you@example.com"
              style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827', boxSizing:'border-box', outline:'none' }}
            />
          </div>
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>パスワード</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              placeholder="••••••••"
              style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827', boxSizing:'border-box', outline:'none' }}
            />
          </div>

          {error && (
            <div style={{ background:'#FEE2E2', color:'#DC2626', padding:'10px 14px', borderRadius:8, fontSize:13 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            padding:'12px', borderRadius:10, border:'none', cursor:'pointer',
            background:'linear-gradient(135deg,#667eea,#764ba2)', color:'#fff',
            fontSize:15, fontWeight:700, marginTop:4,
            opacity: loading ? 0.7 : 1
          }}>
            {loading ? '処理中...' : mode === 'login' ? 'サインイン' : 'アカウント作成'}
          </button>
        </form>

        <div style={{ textAlign:'center', marginTop:20 }}>
          <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}
            style={{ background:'none', border:'none', color:'#667eea', fontSize:13, cursor:'pointer', fontWeight:600 }}>
            {mode === 'login' ? 'アカウントをお持ちでない方はこちら →' : '既にアカウントをお持ちの方はサインイン →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Mini Bar Chart
// ──────────────────────────────────────────────
function MiniBar({ data, color = '#6366F1' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1)
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:40 }}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex:1, background: color, borderRadius:3,
          height: `${(v/max)*100}%`, minHeight:3, opacity: i === data.length-1 ? 1 : 0.5
        }}/>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────
// Donut Chart
// ──────────────────────────────────────────────
function DonutChart({ data, colors, size=120 }: { data: number[]; colors: string[]; size?: number }) {
  const total = data.reduce((a, b) => a + b, 0) || 1
  let cumul = 0
  const r = 40, cx = 60, cy = 60, stroke = 16
  const arcs = data.map((v, i) => {
    const pct = v / total
    const start = cumul; cumul += pct
    const a1 = start * 2 * Math.PI - Math.PI/2
    const a2 = cumul * 2 * Math.PI - Math.PI/2
    const x1 = cx + r*Math.cos(a1), y1 = cy + r*Math.sin(a1)
    const x2 = cx + r*Math.cos(a2), y2 = cy + r*Math.sin(a2)
    const large = pct > 0.5 ? 1 : 0
    return <path key={i} d={`M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}`} fill="none" stroke={colors[i]} strokeWidth={stroke} strokeLinecap="round"/>
  })
  return (
    <svg width={size} height={size} viewBox="0 0 120 120">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={stroke}/>
      {arcs}
    </svg>
  )
}

// ──────────────────────────────────────────────
// Main App
// ──────────────────────────────────────────────
export default function App() {
  const { data: session, isPending: sessionLoading } = authClient.useSession()
  const currentUser: CurrentUser | null = session?.user ? {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: (session.user as any).role ?? 'member',
    image: session.user.image,
  } : null

  const [tab, setTab] = useState<Tab>('form')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(false)
  const [budget, setBudget] = useState(150000)
  const { toasts, show: showToast } = useToast()

  // Filter state
  const now = new Date()
  const [filterYear, setFilterYear] = useState(String(now.getFullYear()))
  const [filterMonth, setFilterMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'))
  const [filterStatus, setFilterStatus] = useState<Status | ''>('')
  const [searchQ, setSearchQ] = useState('')

  // Summary state
  const [summaryByMonth, setSummaryByMonth] = useState<Record<string, any>>({})

  // Admin: all users
  const [allUsers, setAllUsers] = useState<any[]>([])

  // Refresh trigger
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = () => setRefreshKey(k => k + 1)

  // ── Load expenses ──
  useEffect(() => {
    if (!currentUser) return
    setLoading(true)
    const params: Record<string, string> = { year: filterYear, month: filterMonth }
    if (filterStatus) params.status = filterStatus

    const load = async () => {
      try {
        const res = await fetch(`/api/expenses?year=${filterYear}&month=${filterMonth}${filterStatus ? `&status=${filterStatus}` : ''}`, {
          credentials: 'include'
        })
        if (res.ok) {
          const data = await res.json()
          setExpenses(data.expenses ?? [])
        }
      } catch (e) { console.error(e) } finally { setLoading(false) }
    }
    load()
  }, [currentUser?.id, filterYear, filterMonth, filterStatus, refreshKey])

  // ── Load summary ──
  useEffect(() => {
    if (!currentUser) return
    fetch('/api/expenses/summary', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setSummaryByMonth(d.byMonth ?? {}) })
      .catch(console.error)
  }, [currentUser?.id, refreshKey])

  // ── Load budget ──
  useEffect(() => {
    if (!currentUser) return
    fetch('/api/settings/budget', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.value) setBudget(Number(d.value)) })
      .catch(console.error)
  }, [currentUser?.id])

  // ── Load users (admin only) ──
  useEffect(() => {
    if (currentUser?.role !== 'admin') return
    fetch('/api/users', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAllUsers(d.users ?? []))
      .catch(console.error)
  }, [currentUser?.role, refreshKey])

  if (sessionLoading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#F8FAFC' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ width:40, height:40, border:'3px solid #6366F1', borderTop:'3px solid transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite', margin:'0 auto 16px' }}/>
          <p style={{ color:'#64748B', fontSize:14 }}>読み込み中...</p>
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return <LoginScreen/>
  }

  // ── Filtered expenses for current view ──
  const filtered = expenses.filter(e => {
    if (searchQ && !e.title.includes(searchQ) && !e.submitterName.includes(searchQ) && !e.category.includes(searchQ)) return false
    return true
  })

  const totalAmount = filtered.reduce((s, e) => s + e.amount, 0)
  const approvedAmount = filtered.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0)
  const pendingAmount = filtered.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0)
  const budgetUsed = approvedAmount / budget

  const handleSignOut = async () => {
    await authClient.signOut()
    refresh()
  }

  return (
    <div style={{ minHeight:'100vh', background:'#F8FAFC', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        input:focus, select:focus, textarea:focus { outline: 2px solid #6366F1; outline-offset: 1px; }
        button:disabled { cursor: not-allowed; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
      `}</style>
      <Toaster toasts={toasts}/>

      {/* ── Sidebar ── */}
      <div style={{
        position:'fixed', left:0, top:0, bottom:0, width:220,
        background:'linear-gradient(180deg,#1E1B4B 0%,#312E81 100%)',
        display:'flex', flexDirection:'column', zIndex:100
      }}>
        <div style={{ padding:'24px 20px 20px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:'rgba(255,255,255,.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Receipt size={20} color="#fff"/>
            </div>
            <div>
              <div style={{ color:'#fff', fontWeight:700, fontSize:14 }}>精算管理</div>
              <div style={{ color:'rgba(255,255,255,.5)', fontSize:11 }}>v2.0</div>
            </div>
          </div>
        </div>

        <nav style={{ flex:1, padding:'0 12px' }}>
          {([
            ['form', <Receipt size={18}/>, '経費申請'],
            ['history', <ClipboardList size={18}/>, '申請履歴'],
            ['dashboard', <LayoutDashboard size={18}/>, 'ダッシュボード'],
            ...(currentUser.role === 'admin' ? [['admin', <Settings size={18}/>, '管理'] as [Tab, React.ReactNode, string]] : [])
          ] as [Tab, React.ReactNode, string][]).map(([t, icon, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
              borderRadius:10, border:'none', cursor:'pointer', textAlign:'left',
              background: tab === t ? 'rgba(255,255,255,.15)' : 'transparent',
              color: tab === t ? '#fff' : 'rgba(255,255,255,.6)',
              fontSize:14, fontWeight: tab === t ? 600 : 400, marginBottom:2,
              transition:'all .2s'
            }}>
              {icon}{label}
            </button>
          ))}
        </nav>

        <div style={{ padding:'16px 12px', borderTop:'1px solid rgba(255,255,255,.1)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:10 }}>
            <div style={{
              width:34, height:34, borderRadius:10, background:'rgba(255,255,255,.2)',
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
              fontSize:14, fontWeight:700, color:'#fff'
            }}>
              {currentUser.name.charAt(0)}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:'#fff', fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{currentUser.name}</div>
              <div style={{ color:'rgba(255,255,255,.5)', fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {currentUser.role === 'admin' ? '👑 管理者' : 'メンバー'}
              </div>
            </div>
            <button onClick={handleSignOut} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.5)', padding:4 }} title="サインアウト">
              <LogOut size={16}/>
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ marginLeft:220, padding:'32px 32px 32px' }}>
        {tab === 'form' && (
          <FormTab showToast={showToast} onSubmitted={refresh}/>
        )}
        {tab === 'history' && (
          <HistoryTab
            expenses={filtered} loading={loading}
            filterYear={filterYear} filterMonth={filterMonth}
            filterStatus={filterStatus} searchQ={searchQ}
            setFilterYear={setFilterYear} setFilterMonth={setFilterMonth}
            setFilterStatus={setFilterStatus} setSearchQ={setSearchQ}
            currentUser={currentUser} onRefresh={refresh} showToast={showToast}
          />
        )}
        {tab === 'dashboard' && (
          <DashboardTab
            expenses={filtered} totalAmount={totalAmount}
            approvedAmount={approvedAmount} pendingAmount={pendingAmount}
            budget={budget} budgetUsed={budgetUsed}
            summaryByMonth={summaryByMonth}
            filterYear={filterYear} filterMonth={filterMonth}
            setFilterYear={setFilterYear} setFilterMonth={setFilterMonth}
          />
        )}
        {tab === 'admin' && currentUser.role === 'admin' && (
          <AdminTab
            allUsers={allUsers} budget={budget} setBudget={setBudget}
            showToast={showToast} onRefresh={refresh}
          />
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Form Tab
// ──────────────────────────────────────────────
function FormTab({ showToast, onSubmitted }: {
  showToast: (m: string, t?: Toast['type']) => void; onSubmitted: () => void
}) {
  const [form, setForm] = useState({ title:'', amount:'', date: new Date().toISOString().slice(0,10), category: CATEGORIES[0], note:'' })
  const [submitting, setSubmitting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [ocrResult, setOcrResult] = useState<string | null>(null)
  const [receiptKey, setReceiptKey] = useState<string | null>(null)
  const [receiptName, setReceiptName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true)
    setOcrResult(null)
    try {
      // 領収書画像を保存（承認時に管理者が閲覧できるようにする）
      const fd = new FormData()
      fd.append('file', file)
      const upload = await fetch('/api/expenses/receipt', { method: 'POST', credentials: 'include', body: fd })
      if (upload.ok) {
        const { key } = await upload.json()
        setReceiptKey(key)
        setReceiptName(file.name)
      } else {
        const err = await upload.json().catch(() => ({}))
        showToast(err.message ?? '領収書の保存に失敗しました', 'error')
      }
      // OCRで金額・日付・件名を自動入力
      const result = await scanReceipt(file)
      if (result.amount) set('amount', String(result.amount))
      if (result.date) set('date', result.date)
      if (result.title) set('title', result.title)
      setOcrResult(`金額: ¥${result.amount?.toLocaleString() ?? '未検出'} | 日付: ${result.date ?? '未検出'}`)
    } catch {
      showToast('スキャン失敗', 'error')
    } finally {
      setScanning(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.amount || !form.date) { showToast('必須項目を入力してください', 'error'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: form.title, amount: Number(form.amount),
          date: form.date, category: form.category,
          note: form.note || null, receiptImageKey: receiptKey
        })
      })
      if (!res.ok) { const e = await res.json(); showToast(e.message ?? '送信失敗', 'error'); return }
      const data = await res.json()
      showToast('申請を送信しました！', 'success')
      if (data.expense?.aiWarning) showToast('⚠️ ' + data.expense.aiWarning, 'info')
      setForm({ title:'', amount:'', date: new Date().toISOString().slice(0,10), category: CATEGORIES[0], note:'' })
      setOcrResult(null)
      setReceiptKey(null)
      setReceiptName(null)
      onSubmitted()
    } catch { showToast('ネットワークエラー', 'error') } finally { setSubmitting(false) }
  }

  return (
    <div style={{ maxWidth:560 }}>
      <h2 style={{ fontSize:22, fontWeight:700, color:'#1E293B', marginBottom:6 }}>経費申請</h2>
      <p style={{ color:'#64748B', fontSize:14, marginBottom:28 }}>領収書をスキャンして経費を申請します</p>

      {/* Receipt Scanner */}
      <div style={{ marginBottom:24 }}>
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            border:'2px dashed #C7D2FE', borderRadius:14, padding:'20px',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8,
            cursor:'pointer', background:'#F0F4FF', transition:'all .2s'
          }}
        >
          <Upload size={28} color="#6366F1"/>
          <div style={{ textAlign:'center' }}>
            <div style={{ color:'#4F46E5', fontSize:14, fontWeight:600 }}>
              {scanning ? '読み取り中...' : '領収書をスキャン'}
            </div>
            <div style={{ color:'#94A3B8', fontSize:12, marginTop:4 }}>JPG・PNG・PDF対応</div>
          </div>
          {scanning && <div style={{ width:24, height:24, border:'2px solid #6366F1', borderTop:'2px solid transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>}
        </div>
        <input ref={fileRef} type="file" accept="image/*,.pdf" onChange={handleScan} style={{ display:'none' }}/>
        {ocrResult && (
          <div style={{ marginTop:10, background:'#EEF2FF', border:'1px solid #C7D2FE', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#4338CA' }}>
            ✅ OCR結果: {ocrResult}
            {receiptName && <div style={{ marginTop:4, color:'#4F46E5' }}>📎 {receiptName} を添付しました</div>}
          </div>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} style={{ background:'#fff', borderRadius:16, padding:24, boxShadow:'0 2px 12px rgba(0,0,0,.06)', display:'flex', flexDirection:'column', gap:18 }}>
        <div>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>件名 *</label>
          <input value={form.title} onChange={e => set('title', e.target.value)} required placeholder="部署BBQ食材費"
            style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827' }}/>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>金額 *</label>
            <input value={form.amount} onChange={e => set('amount', e.target.value)} required type="number" min="0" placeholder="3500"
              style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827' }}/>
          </div>
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>日付 *</label>
            <input value={form.date} onChange={e => set('date', e.target.value)} required type="date"
              style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827' }}/>
          </div>
        </div>
        <div>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>カテゴリ</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827', background:'#fff' }}>
            {CATEGORIES.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {c}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>備考</label>
          <textarea value={form.note} onChange={e => set('note', e.target.value)} placeholder="補足事項があれば..." rows={3}
            style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827', resize:'vertical' }}/>
        </div>
        <button type="submit" disabled={submitting} style={{
          padding:'13px', borderRadius:11, border:'none', cursor:'pointer',
          background:'linear-gradient(135deg,#667eea,#764ba2)', color:'#fff',
          fontSize:15, fontWeight:700, opacity: submitting ? 0.7 : 1
        }}>
          {submitting ? '送信中...' : '申請を送信'}
        </button>
      </form>
    </div>
  )
}

// ──────────────────────────────────────────────
// History Tab
// ──────────────────────────────────────────────
function HistoryTab({
  expenses, loading, filterYear, filterMonth, filterStatus, searchQ,
  setFilterYear, setFilterMonth, setFilterStatus, setSearchQ,
  currentUser, onRefresh, showToast
}: {
  expenses: Expense[]; loading: boolean; filterYear: string; filterMonth: string
  filterStatus: Status | ''; searchQ: string; setFilterYear: (v: string) => void
  setFilterMonth: (v: string) => void; setFilterStatus: (v: Status | '') => void
  setSearchQ: (v: string) => void; currentUser: CurrentUser
  onRefresh: () => void; showToast: (m: string, t?: Toast['type']) => void
}) {
  const [detail, setDetail] = useState<Expense | null>(null)

  const handleStatusChange = async (id: string, status: Status, rejectionReason?: string) => {
    const res = await fetch(`/api/expenses/${id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ status, rejectionReason: rejectionReason ?? null })
    })
    if (res.ok) { showToast('ステータスを更新しました', 'success'); onRefresh() }
    else showToast('更新に失敗しました', 'error')
  }

  const handleReject = (id: string) => {
    const reason = window.prompt('却下理由を入力してください（任意）') ?? ''
    handleStatusChange(id, 'rejected', reason.trim() || undefined)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return
    const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) { showToast('削除しました', 'success'); onRefresh() }
    else showToast('削除に失敗しました', 'error')
  }

  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i))
  const months = Array.from({ length: 12 }, (_, i) => ({ value: String(i+1).padStart(2,'0'), label: `${i+1}月` }))

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:700, color:'#1E293B', marginBottom:4 }}>申請履歴</h2>
          <p style={{ color:'#64748B', fontSize:14 }}>{expenses.length}件</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => exportCSV(expenses, `精算_${filterYear}${filterMonth}.csv`)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:9, border:'1.5px solid #E2E8F0', background:'#fff', cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151' }}>
            <Download size={15}/> CSV
          </button>
          <button onClick={onRefresh}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:9, border:'1.5px solid #E2E8F0', background:'#fff', cursor:'pointer', fontSize:13, color:'#374151' }}>
            <RefreshCw size={15}/>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ background:'#fff', borderRadius:12, padding:'16px 20px', marginBottom:20, boxShadow:'0 1px 6px rgba(0,0,0,.06)', display:'flex', flexWrap:'wrap', gap:10, alignItems:'center' }}>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
          style={{ padding:'7px 12px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, background:'#fff' }}>
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          style={{ padding:'7px 12px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, background:'#fff' }}>
          {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as Status | '')}
          style={{ padding:'7px 12px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, background:'#fff' }}>
          <option value="">全ステータス</option>
          <option value="pending">審査中</option>
          <option value="approved">承認済</option>
          <option value="rejected">却下</option>
        </select>
        <div style={{ flex:1, minWidth:160, position:'relative' }}>
          <Search size={15} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#64748B' }}/>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="検索..."
            style={{ width:'100%', padding:'7px 12px 7px 32px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13 }}/>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'#64748B' }}>読み込み中...</div>
      ) : expenses.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, color:'#64748B' }}>申請がありません</div>
      ) : (
        <div style={{ background:'#fff', borderRadius:14, boxShadow:'0 2px 12px rgba(0,0,0,.06)', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#F8FAFC', borderBottom:'1px solid #E2E8F0' }}>
                {['件名', '金額', '日付', 'カテゴリ', ...(currentUser.role === 'admin' ? ['申請者'] : []), 'ステータス', ''].map(h => (
                  <th key={h} style={{ padding:'12px 16px', fontSize:12, fontWeight:600, color:'#64748B', textAlign:'left', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e, i) => {
                const sm = STATUS_META[e.status]
                return (
                  <tr key={e.id} style={{ borderBottom: i < expenses.length-1 ? '1px solid #F1F5F9' : 'none', background: e.aiWarning ? '#FFFBEB' : '#fff' }}>
                    <td style={{ padding:'12px 16px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        {e.aiWarning && <AlertTriangle size={14} color="#D97706" style={{ flexShrink:0 }}/>}
                        <span style={{ fontSize:14, fontWeight:500, color:'#1E293B' }}>{e.title}</span>
                      </div>
                      {e.note && <div style={{ fontSize:12, color:'#374151', marginTop:2 }}>{e.note}</div>}
                    </td>
                    <td style={{ padding:'12px 16px', fontSize:14, fontWeight:600, color:'#1E293B', whiteSpace:'nowrap' }}>
                      ¥{e.amount.toLocaleString()}
                    </td>
                    <td style={{ padding:'12px 16px', fontSize:13, color:'#64748B', whiteSpace:'nowrap' }}>{e.date}</td>
                    <td style={{ padding:'12px 16px' }}>
                      <span style={{ fontSize:13 }}>{CAT_EMOJI[e.category] ?? '📦'} {e.category}</span>
                    </td>
                    {currentUser.role === 'admin' && (
                      <td style={{ padding:'12px 16px', fontSize:13, color:'#64748B' }}>{e.submitterName}</td>
                    )}
                    <td style={{ padding:'12px 16px' }}>
                      <span style={{
                        display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px',
                        borderRadius:20, fontSize:12, fontWeight:600,
                        background: sm.bg, color: sm.color
                      }}>
                        {sm.icon}{sm.label}
                      </span>
                    </td>
                    <td style={{ padding:'12px 16px' }}>
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={() => setDetail(e)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94A3B8', padding:4 }}>
                          <Eye size={16}/>
                        </button>
                        {currentUser.role === 'admin' && e.status === 'pending' && (
                          <>
                            <button onClick={() => handleStatusChange(e.id, 'approved')} style={{ background:'#D1FAE5', border:'none', cursor:'pointer', color:'#059669', padding:'4px 8px', borderRadius:6, fontSize:12, fontWeight:600 }}>承認</button>
                            <button onClick={() => handleReject(e.id)} style={{ background:'#FEE2E2', border:'none', cursor:'pointer', color:'#DC2626', padding:'4px 8px', borderRadius:6, fontSize:12, fontWeight:600 }}>却下</button>
                            <button onClick={() => handleDelete(e.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#CBD5E1', padding:4 }}><X size={16}/></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      {detail && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
          onClick={() => setDetail(null)}>
          <div style={{ background:'#fff', borderRadius:18, padding:28, width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <h3 style={{ fontSize:18, fontWeight:700, color:'#1E293B', margin:0 }}>申請詳細</h3>
              <button onClick={() => setDetail(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#64748B' }}><X size={20}/></button>
            </div>
            {detail.aiWarning && (
              <div style={{ background:'#FEF3C7', border:'1px solid #FDE68A', borderRadius:10, padding:'10px 14px', marginBottom:16, fontSize:13, color:'#92400E', display:'flex', gap:8 }}>
                <AlertTriangle size={16} style={{ flexShrink:0, marginTop:1 }}/>{detail.aiWarning}
              </div>
            )}
            {[
              ['件名', detail.title], ['金額', `¥${detail.amount.toLocaleString()}`],
              ['日付', detail.date], ['カテゴリ', `${CAT_EMOJI[detail.category] ?? '📦'} ${detail.category}`],
              ['申請者', detail.submitterName], ['ステータス', STATUS_META[detail.status].label],
              ...(detail.note ? [['備考', detail.note]] : [])
            ].map(([k, v]) => (
              <div key={k as string} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F1F5F9', fontSize:14 }}>
                <span style={{ color:'#64748B', fontWeight:500 }}>{k}</span>
                <span style={{ color:'#1E293B', fontWeight:600, textAlign:'right', maxWidth:'60%' }}>{v}</span>
              </div>
            ))}
            {detail.status === 'rejected' && detail.rejectionReason && (
              <div style={{ background:'#FEE2E2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', marginTop:14, fontSize:13, color:'#991B1B' }}>
                <div style={{ fontWeight:700, marginBottom:2 }}>却下理由</div>
                {detail.rejectionReason}
              </div>
            )}
            {detail.receiptImageKey && (
              <div style={{ marginTop:16 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#374151', marginBottom:8 }}>領収書</div>
                <a href={`/api/expenses/${detail.id}/receipt`} target="_blank" rel="noreferrer">
                  <img
                    src={`/api/expenses/${detail.id}/receipt`}
                    alt="領収書"
                    style={{ width:'100%', borderRadius:10, border:'1px solid #E2E8F0', cursor:'zoom-in' }}
                    onError={(e) => { (e.currentTarget.style.display = 'none') }}
                  />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// Dashboard Tab
// ──────────────────────────────────────────────
function DashboardTab({
  expenses, totalAmount, approvedAmount, pendingAmount,
  budget, budgetUsed, summaryByMonth,
  filterYear, filterMonth, setFilterYear, setFilterMonth
}: {
  expenses: Expense[]; totalAmount: number; approvedAmount: number; pendingAmount: number
  budget: number; budgetUsed: number; summaryByMonth: Record<string, any>
  filterYear: string; filterMonth: string; setFilterYear: (v: string) => void; setFilterMonth: (v: string) => void
}) {
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i))
  const months = Array.from({ length: 12 }, (_, i) => ({ value: String(i+1).padStart(2,'0'), label: `${i+1}月` }))

  // Cat breakdown
  const catTotals: Record<string, number> = {}
  for (const e of expenses) catTotals[e.category] = (catTotals[e.category] ?? 0) + e.amount
  const catEntries = Object.entries(catTotals).sort((a,b) => b[1] - a[1])

  // Monthly trend (last 6 months from summaryByMonth)
  const sortedMonths = Object.keys(summaryByMonth).sort()
  const last6 = sortedMonths.slice(-6)
  const trendData = last6.map(k => summaryByMonth[k]?.total ?? 0)

  const budgetColor = budgetUsed >= 1 ? '#EF4444' : budgetUsed >= 0.8 ? '#F59E0B' : '#10B981'

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:700, color:'#1E293B', marginBottom:4 }}>ダッシュボード</h2>
          <p style={{ color:'#64748B', fontSize:14 }}>{filterYear}年{parseInt(filterMonth)}月</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
            style={{ padding:'7px 12px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, background:'#fff' }}>
            {years.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            style={{ padding:'7px 12px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, background:'#fff' }}>
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:16, marginBottom:24 }}>
        {[
          { label:'総申請額', value:`¥${totalAmount.toLocaleString()}`, sub:`${expenses.length}件`, color:'#6366F1', bg:'#EEF2FF', icon:<TrendingUp size={22}/> },
          { label:'承認済', value:`¥${approvedAmount.toLocaleString()}`, sub:`${expenses.filter(e=>e.status==='approved').length}件`, color:'#059669', bg:'#D1FAE5', icon:<Check size={22}/> },
          { label:'審査中', value:`¥${pendingAmount.toLocaleString()}`, sub:`${expenses.filter(e=>e.status==='pending').length}件`, color:'#D97706', bg:'#FEF3C7', icon:<Clock size={22}/> },
          { label:'予算残', value:`¥${Math.max(0, budget - approvedAmount).toLocaleString()}`, sub:`¥${budget.toLocaleString()}中`, color: budgetColor, bg: budgetUsed>=0.8 ? '#FEF3C7' : '#D1FAE5', icon:<Wallet size={22}/> },
        ].map(c => (
          <div key={c.label} style={{ background:'#fff', borderRadius:14, padding:20, boxShadow:'0 2px 10px rgba(0,0,0,.06)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <span style={{ fontSize:13, fontWeight:600, color:'#64748B' }}>{c.label}</span>
              <div style={{ width:40, height:40, borderRadius:10, background:c.bg, display:'flex', alignItems:'center', justifyContent:'center', color:c.color }}>{c.icon}</div>
            </div>
            <div style={{ fontSize:24, fontWeight:700, color:'#1E293B' }}>{c.value}</div>
            <div style={{ fontSize:12, color:'#374151', marginTop:4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Budget Bar */}
      <div style={{ background:'#fff', borderRadius:14, padding:20, boxShadow:'0 2px 10px rgba(0,0,0,.06)', marginBottom:24 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
          <span style={{ fontSize:14, fontWeight:600, color:'#374151' }}>月次予算使用率</span>
          <span style={{ fontSize:14, fontWeight:700, color: budgetColor }}>{Math.round(budgetUsed*100)}%</span>
        </div>
        <div style={{ height:10, background:'#F1F5F9', borderRadius:5, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${Math.min(budgetUsed*100, 100)}%`, background: budgetColor, borderRadius:5, transition:'width .8s ease' }}/>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:8, fontSize:12, color:'#374151' }}>
          <span>¥{approvedAmount.toLocaleString()} 使用</span>
          <span>上限 ¥{budget.toLocaleString()}</span>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        {/* Category breakdown */}
        <div style={{ background:'#fff', borderRadius:14, padding:20, boxShadow:'0 2px 10px rgba(0,0,0,.06)' }}>
          <h3 style={{ fontSize:15, fontWeight:700, color:'#1E293B', marginBottom:16 }}>カテゴリ別</h3>
          {catEntries.length === 0 ? (
            <div style={{ textAlign:'center', color:'#94A3B8', padding:20, fontSize:13 }}>データなし</div>
          ) : (
            <div style={{ display:'flex', gap:16, alignItems:'center' }}>
              <DonutChart data={catEntries.map(([,v]) => v)} colors={catEntries.map((_,i) => CAT_COLORS[i % CAT_COLORS.length])}/>
              <div style={{ flex:1 }}>
                {catEntries.map(([cat, amt], i) => (
                  <div key={cat} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                    <div style={{ width:10, height:10, borderRadius:3, background: CAT_COLORS[i % CAT_COLORS.length], flexShrink:0 }}/>
                    <div style={{ flex:1, fontSize:12, color:'#374151' }}>{CAT_EMOJI[cat] ?? '📦'} {cat}</div>
                    <div style={{ fontSize:12, fontWeight:700, color:'#1E293B' }}>¥{amt.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Monthly trend */}
        <div style={{ background:'#fff', borderRadius:14, padding:20, boxShadow:'0 2px 10px rgba(0,0,0,.06)' }}>
          <h3 style={{ fontSize:15, fontWeight:700, color:'#1E293B', marginBottom:4 }}>月次推移（過去6ヶ月）</h3>
          <p style={{ fontSize:12, color:'#374151', marginBottom:16 }}>承認済申請の合計</p>
          {trendData.length === 0 ? (
            <div style={{ textAlign:'center', color:'#94A3B8', padding:20, fontSize:13 }}>データなし</div>
          ) : (
            <>
              <MiniBar data={trendData} color="#6366F1"/>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:8 }}>
                {last6.map(k => (
                  <div key={k} style={{ fontSize:11, color:'#64748B' }}>{k.slice(5)}月</div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Admin Tab
// ──────────────────────────────────────────────
function AdminTab({ allUsers, budget, setBudget, showToast, onRefresh }: {
  allUsers: any[]; budget: number; setBudget: (v: number) => void
  showToast: (m: string, t?: Toast['type']) => void; onRefresh: () => void
}) {
  const [newBudget, setNewBudget] = useState(String(budget))
  const [savingBudget, setSavingBudget] = useState(false)

  // 招待管理
  const [invites, setInvites] = useState<any[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  const loadInvites = async () => {
    const res = await fetch('/api/invitations', { credentials: 'include' })
    if (res.ok) { const d = await res.json(); setInvites(d.invitations ?? []) }
  }
  useEffect(() => { loadInvites() }, [])

  const createInvite = async () => {
    if (!inviteEmail) { showToast('メールアドレスを入力してください', 'error'); return }
    setInviting(true)
    const res = await fetch('/api/invitations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ email: inviteEmail, role: inviteRole })
    })
    if (res.ok) {
      const d = await res.json()
      setLastLink(d.link)
      setInviteEmail('')
      showToast('招待を作成しました', 'success')
      loadInvites()
    } else {
      const e = await res.json().catch(() => ({}))
      showToast(e.message ?? '招待の作成に失敗しました', 'error')
    }
    setInviting(false)
  }

  const cancelInvite = async (id: string) => {
    const res = await fetch(`/api/invitations/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) { showToast('招待を取り消しました', 'success'); loadInvites() }
    else showToast('取り消しに失敗しました', 'error')
  }

  const copyLink = (link: string) => {
    navigator.clipboard?.writeText(link)
    showToast('リンクをコピーしました', 'success')
  }

  const saveBudget = async () => {
    setSavingBudget(true)
    const res = await fetch('/api/settings/budget', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ value: newBudget })
    })
    if (res.ok) { setBudget(Number(newBudget)); showToast('予算を更新しました', 'success') }
    else showToast('更新失敗', 'error')
    setSavingBudget(false)
  }

  const changeRole = async (userId: string, role: 'member' | 'admin') => {
    const res = await fetch(`/api/users/${userId}/role`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ role })
    })
    if (res.ok) { showToast('ロールを更新しました', 'success'); onRefresh() }
    else showToast('更新失敗', 'error')
  }

  const deleteUser = async (userId: string, userName: string) => {
    if (!confirm(`${userName} を削除しますか？`) ) return
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) { showToast('ユーザーを削除しました', 'success'); onRefresh() }
    else showToast('削除失敗', 'error')
  }

  return (
    <div style={{ maxWidth:700 }}>
      <h2 style={{ fontSize:22, fontWeight:700, color:'#1E293B', marginBottom:6 }}>管理設定</h2>
      <p style={{ color:'#64748B', fontSize:14, marginBottom:28 }}>予算管理・ユーザー管理</p>

      {/* Budget Setting */}
      <div style={{ background:'#fff', borderRadius:16, padding:24, boxShadow:'0 2px 12px rgba(0,0,0,.06)', marginBottom:24 }}>
        <h3 style={{ fontSize:16, fontWeight:700, color:'#1E293B', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>
          <Wallet size={18} color="#6366F1"/> 月次予算設定
        </h3>
        <div style={{ display:'flex', gap:12, alignItems:'flex-end' }}>
          <div style={{ flex:1 }}>
            <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>月次予算（円）</label>
            <input type="number" value={newBudget} onChange={e => setNewBudget(e.target.value)} min="0"
              style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827' }}/>
          </div>
          <button onClick={saveBudget} disabled={savingBudget}
            style={{ padding:'10px 20px', borderRadius:10, border:'none', cursor:'pointer', background:'#6366F1', color:'#fff', fontSize:14, fontWeight:700, whiteSpace:'nowrap' }}>
            {savingBudget ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Member Invitations */}
      <div style={{ background:'#fff', borderRadius:16, padding:24, boxShadow:'0 2px 12px rgba(0,0,0,.06)', marginBottom:24 }}>
        <h3 style={{ fontSize:16, fontWeight:700, color:'#1E293B', marginBottom:6, display:'flex', alignItems:'center', gap:8 }}>
          <UserPlus size={18} color="#6366F1"/> メンバー招待
        </h3>
        <p style={{ color:'#64748B', fontSize:13, marginBottom:16 }}>招待リンクを発行し、メンバーに共有してください（リンクから登録できます）</p>
        <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>メールアドレス</label>
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="member@example.com"
              style={{ width:'100%', padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, color:'#111827' }}/>
          </div>
          <div>
            <label style={{ fontSize:13, fontWeight:600, color:'#374151', display:'block', marginBottom:6 }}>ロール</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'member' | 'admin')}
              style={{ padding:'10px 14px', border:'1.5px solid #E2E8F0', borderRadius:10, fontSize:14, background:'#fff' }}>
              <option value="member">メンバー</option>
              <option value="admin">管理者</option>
            </select>
          </div>
          <button onClick={createInvite} disabled={inviting}
            style={{ padding:'10px 20px', borderRadius:10, border:'none', cursor:'pointer', background:'#6366F1', color:'#fff', fontSize:14, fontWeight:700, whiteSpace:'nowrap' }}>
            {inviting ? '発行中...' : '招待を発行'}
          </button>
        </div>
        {lastLink && (
          <div style={{ marginTop:14, background:'#EEF2FF', border:'1px solid #C7D2FE', borderRadius:10, padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
            <code style={{ flex:1, fontSize:12, color:'#4338CA', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lastLink}</code>
            <button onClick={() => copyLink(lastLink)} style={{ display:'flex', alignItems:'center', gap:4, background:'#fff', border:'1px solid #C7D2FE', borderRadius:8, padding:'6px 10px', cursor:'pointer', fontSize:12, fontWeight:600, color:'#4338CA' }}>
              <Copy size={13}/> コピー
            </button>
          </div>
        )}
        {invites.filter(iv => !iv.used).length > 0 && (
          <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:8 }}>
            {invites.filter(iv => !iv.used).map(iv => (
              <div key={iv.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'#F8FAFC', borderRadius:10, border:'1px solid #F1F5F9' }}>
                <div style={{ flex:1, fontSize:13, color:'#1E293B' }}>{iv.email}</div>
                <span style={{ fontSize:12, color:'#64748B' }}>{iv.role === 'admin' ? '管理者' : 'メンバー'}</span>
                <button onClick={() => cancelInvite(iv.id)} style={{ background:'#FEE2E2', border:'none', cursor:'pointer', color:'#DC2626', padding:'5px 10px', borderRadius:8, fontSize:12, fontWeight:600 }}>取消</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Management */}
      <div style={{ background:'#fff', borderRadius:16, padding:24, boxShadow:'0 2px 12px rgba(0,0,0,.06)' }}>
        <h3 style={{ fontSize:16, fontWeight:700, color:'#1E293B', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>
          <Users size={18} color="#6366F1"/> ユーザー管理
        </h3>
        {allUsers.length === 0 ? (
          <div style={{ textAlign:'center', color:'#94A3B8', padding:30, fontSize:13 }}>ユーザーなし</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {allUsers.map(u => (
              <div key={u.id} style={{
                display:'flex', alignItems:'center', gap:14, padding:'14px 16px',
                background:'#F8FAFC', borderRadius:12, border:'1px solid #F1F5F9'
              }}>
                <div style={{
                  width:38, height:38, borderRadius:10, background:'linear-gradient(135deg,#667eea,#764ba2)',
                  display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:14
                }}>
                  {u.name?.charAt(0) ?? '?'}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:'#1E293B' }}>{u.name}</div>
                  <div style={{ fontSize:12, color:'#374151' }}>{u.email}</div>
                </div>
                <select value={u.role} onChange={e => changeRole(u.id, e.target.value as 'member' | 'admin')}
                  style={{ padding:'6px 10px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, background:'#fff', cursor:'pointer' }}>
                  <option value="member">メンバー</option>
                  <option value="admin">管理者</option>
                </select>
                <button onClick={() => deleteUser(u.id, u.name)}
                  style={{ background:'#FEE2E2', border:'none', cursor:'pointer', color:'#DC2626', padding:'6px 10px', borderRadius:8, fontSize:12, fontWeight:600 }}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
