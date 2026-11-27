import { B8DashboardClient } from './b8-api'

export const b8DashboardClient = new B8DashboardClient({
  apiBaseUrl: import.meta.env.VITE_B8_API_BASE_URL ?? '',
  websocketBaseUrl: import.meta.env.VITE_B8_WS_BASE_URL ?? '',
})
