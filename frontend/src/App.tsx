import { DashboardLayout } from './app/DashboardLayout'
import { DashboardProvider } from './data/DashboardProvider'
import './App.css'

export default function App() {
  return <DashboardProvider><DashboardLayout /></DashboardProvider>
}
