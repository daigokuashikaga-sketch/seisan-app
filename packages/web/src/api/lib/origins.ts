// 許可オリジンを env から解決（CORS と Better-Auth trustedOrigins で共有）。
// ALLOWED_ORIGINS（カンマ区切り）> WEBSITE_URL > localhost 既定。
export function getAllowedOrigins(): string[] {
  const fromEnv = process.env.ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (fromEnv && fromEnv.length) return fromEnv

  const origins = new Set<string>()
  if (process.env.WEBSITE_URL) origins.add(process.env.WEBSITE_URL)
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000")
    origins.add("http://localhost:4200")
  }
  return [...origins]
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false
  return getAllowedOrigins().includes(origin)
}
