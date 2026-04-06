import { Calculator } from 'lucide-react'
import SalaryCalculatorForm from '../../components/SalaryCalculatorForm'

export default function SalaryCalculatorPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
          <Calculator size={20} className="text-brand-600"/>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Salary Calculator</h1>
          <p className="text-sm text-slate-500">Enter CTC to generate breakup, then manually override any component</p>
        </div>
      </div>
      <SalaryCalculatorForm onChange={() => {}} showInstructions={true}/>
    </div>
  )
}
