import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { ShieldOff } from 'lucide-react'

export default function AccessDeniedPage() {
  const { logout, user } = useAuthStore()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="text-center max-w-md animate-slide-up">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-50 border border-red-100 mb-6">
          <ShieldOff className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-2xl font-display font-bold text-slate-900 mb-2">Access Denied</h1>
        <p className="text-slate-500 text-sm mb-2">
          Your account <span className="font-medium text-slate-700">{user?.email}</span> does not have permission to access this resource.
        </p>
        <p className="text-slate-400 text-xs mb-8">
          Contact your HR administrator to get the correct role assigned in Microsoft 365.
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => navigate(-1)} className="btn-secondary">Go Back</button>
          <button onClick={() => { logout(); navigate('/login') }} className="btn-primary">Sign Out</button>
        </div>
      </div>
    </div>
  )
}
