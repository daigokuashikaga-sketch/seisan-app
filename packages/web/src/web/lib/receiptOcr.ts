/**
 * receiptOcr.ts — 金額読み取り精度強化版
 */
import { createWorker } from 'tesseract.js'

type Category = '食品・飲料' | '装飾・備品' | '印刷・コピー' | '交通費' | '通信費' | 'その他'

const CAT_KEYWORDS: { cat: Category; kw: RegExp }[] = [
  { cat: '食品・飲料',  kw: /スーパー|食品|飲料|コンビニ|ストア|マート|食材|スナック|惣菜|弁当|grocery|food|drink|cafe|カフェ|レストラン|restaurant|ファミリー|ファミマ|セブン|ローソン|イオン|西友|ライフ|業務スーパー|ダイエー/ },
  { cat: '装飾・備品',  kw: /装飾|ホームセンター|ハンズ|東急|コーナン|カインズ|ニトリ|100均|ダイソー|セリア|キャンドゥ|文具|文房具|雑貨|備品|decor|supplies/ },
  { cat: '印刷・コピー',kw: /印刷|コピー|プリント|キンコーズ|フォトプリント|print|copy|poster/ },
  { cat: '交通費',      kw: /電車|バス|タクシー|交通|鉄道|JR|メトロ|私鉄|IC|Suica|PASMO|運賃|transit|train|bus|taxi/ },
  { cat: '通信費',      kw: /通信|インターネット|wifi|Wi-Fi|docomo|au|softbank|携帯|スマホ|mobile|network/ },
]

function guessCategory(text: string): Category {
  const t = text.toLowerCase()
  for (const { cat, kw } of CAT_KEYWORDS) {
    if (kw.test(t)) return cat
  }
  return 'その他'
}

// ── 金額抽出（精度強化版）──
function extractAmount(text: string): number {
  // OCRでよくある誤認識を補正
  const corrected = text
    .replace(/[Oo]/g, '0')   // O→0
    .replace(/[lI]/g, '1')   // l,I→1
    .replace(/[Ss]/g, '5')   // S→5 (部分的に)
    .replace(/　/g, ' ')      // 全角スペース

  // 優先度順パターン
  const priorityPatterns = [
    // 合計・税込合計・お会計などの直後の金額（最優先）
    /(?:合[計算]|税込(?:合計)?|お(?:会|買い上げ)計|御会計|お支払|ご請求|total\s*amount|grand\s*total)[^\d\n]*?[\¥￥]?\s*([\d,．.]+)/gi,
    // ¥ や ￥ 直後（2番目）
    /[\¥￥]\s*([\d,]+)/g,
    // 数字の後ろに「円」（3番目）
    /([\d,]+)\s*円/g,
    // 小計
    /小計[^\d\n]*?([\d,]+)/gi,
  ]

  const candidates: number[] = []

  for (const pattern of priorityPatterns) {
    let m: RegExpExecArray | null
    const rx = new RegExp(pattern.source, pattern.flags)
    while ((m = rx.exec(corrected)) !== null) {
      const raw = m[1].replace(/[,．]/g, '').replace(/\./g, '')
      const n = parseInt(raw, 10)
      if (n >= 10 && n < 10_000_000) {
        candidates.push(n)
        // 合計系パターンにヒットしたら最優先で返す
        if (pattern === priorityPatterns[0]) return n
      }
    }
    if (candidates.length > 0) break
  }

  if (candidates.length > 0) {
    // 複数候補があれば最大値（合計金額が最大になることが多い）
    return Math.max(...candidates)
  }

  // フォールバック: 3桁以上の数値で最大
  const allNums = [...corrected.matchAll(/\b([\d,]{3,})\b/g)]
    .map(m => parseInt(m[1].replace(/,/g, ''), 10))
    .filter(n => n >= 100 && n < 10_000_000)
  return allNums.length ? Math.max(...allNums) : 0
}

function extractDate(text: string): string {
  const today = new Date().toISOString().split('T')[0]
  const patterns = [
    /(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/,
    /(\d{2,4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    /R(\d{1,2})[年\.](\d{1,2})[月\.](\d{1,2})/,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      let year = parseInt(m[1])
      if (p.source.startsWith('R')) year = 2018 + year
      else if (year < 100) year += year > 50 ? 1900 : 2000
      const month = parseInt(m[2]).toString().padStart(2, '0')
      const day = parseInt(m[3]).toString().padStart(2, '0')
      const d = `${year}-${month}-${day}`
      if (d >= '2000-01-01' && d <= '2099-12-31') return d
    }
  }
  return today
}

function extractTitle(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines.slice(0, 8)) {
    if (line.length >= 2 && line.length <= 40 && /[^\d\s\¥￥,\/\-\.\(\)]/.test(line)) {
      if (/^(領収書|receipt|invoice|レシート|お買い上げ|\*+|=+|-+)/i.test(line)) continue
      if (/^\d+$/.test(line)) continue
      return line
    }
  }
  return ''
}

// 画像前処理（グレースケール + コントラスト強化 + 二値化）
function preprocessImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const maxSide = 2400  // より大きくして精度向上
      const scale = Math.min(maxSide / img.width, maxSide / img.height, 1)
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = id.data

      // グレースケール変換
      for (let i = 0; i < d.length; i += 4) {
        const gray = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
        d[i] = d[i + 1] = d[i + 2] = gray
      }

      // Otsu法に近い簡易閾値で適応二値化
      // まずヒストグラムで閾値を決める
      const hist = new Array(256).fill(0)
      for (let i = 0; i < d.length; i += 4) hist[d[i]]++
      const total = (d.length / 4)
      let sum = 0
      for (let t = 0; t < 256; t++) sum += t * hist[t]
      let sumB = 0, wB = 0, max = 0, threshold = 128
      for (let t = 0; t < 256; t++) {
        wB += hist[t]
        if (wB === 0) continue
        const wF = total - wB
        if (wF === 0) break
        sumB += t * hist[t]
        const mB = sumB / wB
        const mF = (sum - sumB) / wF
        const between = wB * wF * (mB - mF) ** 2
        if (between > max) { max = between; threshold = t }
      }

      // 二値化（テキストの視認性を最大化）
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i] > threshold ? 255 : 0
        d[i] = d[i + 1] = d[i + 2] = v
      }
      ctx.putImageData(id, 0, 0)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = url
  })
}

export interface OcrResult {
  title: string
  amount: number
  date: string
  category: Category
  note: string
  rawText: string
  confidence: number
}

export async function scanReceipt(
  file: File,
  onProgress?: (pct: number, msg: string) => void
): Promise<OcrResult> {
  onProgress?.(5, '画像を前処理中...')
  const dataUrl = await preprocessImage(file)

  onProgress?.(15, 'OCRエンジンを起動中...')
  const worker = await createWorker(['jpn', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress?.(15 + Math.round(m.progress * 75), `読み取り中... ${Math.round(m.progress * 100)}%`)
      }
    },
  })

  await worker.setParameters({
    tessedit_pageseg_mode: '6' as any,
    preserve_interword_spaces: '1' as any,
  })

  onProgress?.(25, 'テキストを認識中...')
  const { data } = await worker.recognize(dataUrl)
  await worker.terminate()

  const text = data.text
  onProgress?.(95, '解析中...')

  const amount = extractAmount(text)
  const date = extractDate(text)
  const rawTitle = extractTitle(text)
  const category = guessCategory(text)
  const confidence = Math.round(data.confidence)

  const title = rawTitle || (category !== 'その他' ? `${category}の購入` : 'レシートからの申請')
  const note = `OCR自動入力（信頼度: ${confidence}%）`

  onProgress?.(100, '完了')

  return { title, amount, date, category, note, rawText: text, confidence }
}
