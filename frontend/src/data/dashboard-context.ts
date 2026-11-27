import { createContext } from 'react'
import type { DashboardSnapshot } from '../types/dashboard'

export const DashboardContext = createContext<DashboardSnapshot | null>(null)
