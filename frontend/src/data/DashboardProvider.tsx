import type { ReactNode } from 'react'
import type { DashboardSnapshot } from '../types/dashboard'
import { DashboardContext } from './dashboard-context'
import { initialSnapshot } from './initial-state'

interface DashboardProviderProps {
  children: ReactNode
  snapshot?: DashboardSnapshot
}

/**
 * Explicit injection point for a future validated data adapter.
 * No connection, simulated stream or successful status is created here.
 */
export function DashboardProvider({
  children,
  snapshot = initialSnapshot,
}: DashboardProviderProps) {
  return <DashboardContext.Provider value={snapshot}>{children}</DashboardContext.Provider>
}
