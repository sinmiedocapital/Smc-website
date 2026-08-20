const MARKETS = [
  { id: 'sp500', symbol: '^GSPC', label: 'S&P 500', format: 'index' },
  { id: 'nasdaq', symbol: '^IXIC', label: 'NASDAQ', format: 'index' },
  { id: 'us10y', symbol: '^TNX', label: 'US10Y', format: 'yield' },
  { id: 'dxy', symbol: 'DX-Y.NYB', label: 'DXY', format: 'index' },
  { id: 'btc', symbol: 'BTC-USD', label: 'BTC/USD', format: 'bitcoin' },
  { id: 'vix', symbol: '^VIX', label: 'VIX', format: 'index' },
] as const

type Market = (typeof MARKETS)[number]

type ChartResponse = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number }
      indicators?: { quote?: Array<{ close?: Array<number | null> }> }
    }>
    error?: unknown
  }
}

async function fetchMarket(market: Market) {
  const endpoint = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.symbol)}`,
  )
  endpoint.searchParams.set('interval', '1d')
  endpoint.searchParams.set('range', '1mo')

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Sin-Miedo-Capital-Market-Ticker/1.0',
    },
    signal: AbortSignal.timeout(6000),
  })

  if (!response.ok) {
    throw new Error(`Market source returned ${response.status}`)
  }

  const payload = (await response.json()) as ChartResponse
  const chart = payload.chart?.result?.[0]
  const closes = chart?.indicators?.quote?.[0]?.close?.filter(
    (close): close is number => typeof close === 'number' && Number.isFinite(close),
  )

  if (!chart || !closes || closes.length < 2) {
    throw new Error('Market source returned incomplete data')
  }

  const current = chart.meta?.regularMarketPrice ?? closes.at(-1)
  const previousClose = closes.at(-2)

  if (current === undefined || previousClose === undefined || previousClose === 0) {
    throw new Error('Market source returned invalid pricing')
  }

  return {
    id: market.id,
    label: market.label,
    format: market.format,
    price: current,
    changePercent: ((current - previousClose) / previousClose) * 100,
  }
}

export default async () => {
  const results = await Promise.allSettled(MARKETS.map(fetchMarket))
  const markets = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )

  if (markets.length === 0) {
    return Response.json(
      { error: 'Market data is temporarily unavailable.' },
      {
        status: 502,
        headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' },
      },
    )
  }

  return Response.json(
    {
      markets,
      updatedAt: new Date().toISOString(),
      delayed: true,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    },
  )
}

export const config = {
  path: '/api/market-data',
  method: 'GET',
}
