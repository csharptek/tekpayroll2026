import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Upload, RefreshCw, Eye, Pencil, UserX, MoreHorizontal } from 'lucide-react'
import { employeeApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import {
  PageHeader, Button, SearchBar, StatusBadge,
  Table, Th, Td, Tr, EmptyState, TableSkeleton, Card, Modal
} from '../../components/ui'

const DEPARTMENTS = ['All', 'Engineering', 'Product', 'Design', 'HR', 'Finance', 'Sales', 'Operations']
const STATUSES    = ['All', 'ACTIVE', 'ON_NOTICE', 'INACTIVE', 'SEPARATED']

export default function EmployeeListPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch]       = useState('')
  const [department, setDept]     = useState('All')
  const [status, setStatus]       = useState('All')
  const [page, setPage]           = useState(1)
  const [deactivateTarget, setDeactivateTarget] = useState<any>(null)
  const [openMenu, setOpenMenu]   = useState<string | null>(null)
  const { user } = useAuthStore()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const params: any = { page, limit: 20 }
  if (search)              params.search = search
  if (department !== 'All') params.department = department
  if (status !== 'All')    params.status = status

  const { data, isLoading } = useQuery({
    queryKey: ['employees', params],
    queryFn: () => employeeApi.list(params).then(r => r.data),
  })

  const deactivateMut = useMutation({
    mutationFn: (id: string) => employeeApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      setDeactivateTarget(null)
    },
  })

  const employees = data?.data || []
  const pagination = data?.pagination

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        subtitle={`${pagination?.total ?? '—'} total employees`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" icon={<Upload size={14} />} onClick={() => navigate('/hr/import')}>
              Bulk Import
            </Button>
            <Button icon={<Plus size={14} />} onClick={() => navigate('/hr/employees/add')}>
              Add Employee
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card>
        <div className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <SearchBar
              value={search}
              onChange={(v) => { setSearch(v); setPage(1) }}
              placeholder="Search by name, email or employee ID…"
            />
          </div>
          <select
            value={department}
            onChange={e => { setDept(e.target.value); setPage(1) }}
            className="input w-full sm:w-44"
          >
            {DEPARTMENTS.map(d => <option key={d} value={d}>{d === 'All' ? 'All Departments' : d}</option>)}
          </select>
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); setPage(1) }}
            className="input w-full sm:w-40"
          >
            {STATUSES.map(s => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s.replace('_', ' ')}</option>)}
          </select>
        </div>

        {/* Table */}
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : employees.length === 0 ? (
          <EmptyState
            icon={<RefreshCw size={22} />}
            title="No employees found"
            description="Try adjusting your filters or add your first employee."
            action={<Button size="sm" icon={<Plus size={13} />} onClick={() => navigate('/hr/employees/add')}>Add Employee</Button>}
          />
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Employee</Th>
                <Th>ID</Th>
                <Th>Department</Th>
                <Th>Designation</Th>
                {isSuperAdmin && <Th className="text-right">Annual CTC</Th>}
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp: any) => (
                <Tr key={emp.id} onClick={() => navigate(`/hr/employees/${emp.id}`)}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-100 border border-brand-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-brand-700">
                          {emp.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{emp.name}</p>
                        <p className="text-xs text-slate-400">{emp.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                      {emp.employeeCode}
                    </span>
                  </Td>
                  <Td>{emp.department || <span className="text-slate-300">—</span>}</Td>
                  <Td>{emp.jobTitle || <span className="text-slate-300">—</span>}</Td>
                  {isSuperAdmin && (
                    <Td className="text-right">
                      <span className="rupee text-sm font-semibold text-slate-800">
                        ₹{Number(emp.annualCtc).toLocaleString('en-IN')}
                      </span>
                    </Td>
                  )}
                  <Td><StatusBadge status={emp.status} /></Td>
                  <Td>
                    <div
                      className="relative"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        onClick={() => setOpenMenu(openMenu === emp.id ? null : emp.id)}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenu === emp.id && (
                        <div className="absolute right-0 top-8 bg-white border border-slate-100 rounded-xl shadow-card-lg z-10 py-1 w-44 animate-fade-in">
                          <button
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                            onClick={() => { navigate(`/hr/employees/${emp.id}`); setOpenMenu(null) }}
                          >
                            <Eye size={13} /> View Detail
                          </button>
                          <button
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                            onClick={() => { navigate(`/hr/employees/${emp.id}/edit`); setOpenMenu(null) }}
                          >
                            <Pencil size={13} /> Edit
                          </button>
                          {emp.status === 'ACTIVE' && (
                            <button
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors border-t border-slate-100 mt-1"
                              onClick={() => { setDeactivateTarget(emp); setOpenMenu(null) }}
                            >
                              <UserX size={13} /> Deactivate
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, pagination.total)} of {pagination.total}
            </p>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Deactivate confirm modal */}
      <Modal
        open={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        title="Deactivate Employee"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeactivateTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={deactivateMut.isPending}
              onClick={() => deactivateMut.mutate(deactivateTarget.id)}
            >
              Deactivate
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Are you sure you want to deactivate <span className="font-semibold text-slate-800">{deactivateTarget?.name}</span>?
          They will lose access to the payroll system and will be excluded from future payroll runs.
        </p>
      </Modal>
    </div>
  )
}
