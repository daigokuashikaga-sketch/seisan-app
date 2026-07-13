import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
  message?: string
}

// 予期しないレンダリングエラーで画面が真っ白になるのを防ぐ。
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error:", error, info)
  }

  override render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: "32px 28px", maxWidth: 420, textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,.08)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1E293B", margin: "0 0 8px" }}>問題が発生しました</h1>
          <p style={{ color: "#64748B", fontSize: 14, marginBottom: 20 }}>
            画面の表示中にエラーが発生しました。ページを再読み込みしてください。
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "10px 20px", borderRadius: 10, border: "none", cursor: "pointer", background: "#6366F1", color: "#fff", fontSize: 14, fontWeight: 700 }}
          >
            再読み込み
          </button>
        </div>
      </div>
    )
  }
}
