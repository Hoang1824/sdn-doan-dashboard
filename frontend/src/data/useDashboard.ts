import { useContext } from 'react'
import { DashboardContext } from './dashboard-context'

export function useDashboard() {
  const snapshot = useContext(DashboardContext)

  if (snapshot === null) {
    throw new Error('useDashboard must be used inside DashboardProvider')
  }

  return snapshot
}
