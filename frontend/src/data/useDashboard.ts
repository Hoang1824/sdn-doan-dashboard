import { useContext } from 'react'
import { DashboardContext } from './dashboard-context'

export function useDashboard() {
  const dashboard = useContext(DashboardContext)

  if (dashboard === null) {
    throw new Error('useDashboard must be used inside DashboardProvider')
  }

  return dashboard
}
