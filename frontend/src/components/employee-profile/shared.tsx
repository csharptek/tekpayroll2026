import React from 'react'
import api from '../../services/api'

export const profileApi = {
  updateProfile:     (id: string, data: any) => api.put(`/api/employees/${id}/profile`, data),
  uploadPhoto:       (id: string, file: File) => {
    const fd = new FormData(); fd.append('photo', file)
    return api.post(`/api/employees/${id}/profile/photo`, fd)
  },
  updateAddress:     (id: string, data: any) => api.put(`/api/employees/${id}/address`, data),
  updateGovId:       (id: string, data: any) => api.put(`/api/employees/${id}/government-id`, data),
  updateEmployment:  (id: string, data: any) => api.put(`/api/employees/${id}/employment`, data),

  getContacts:       (id: string) => api.get(`/api/employees/${id}/contacts`),
  addContact:        (id: string, data: any) => api.post(`/api/employees/${id}/contacts`, data),
  updateContact:     (id: string, cid: string, data: any) => api.put(`/api/employees/${id}/contacts/${cid}`, data),
  deleteContact:     (id: string, cid: string) => api.delete(`/api/employees/${id}/contacts/${cid}`),

  getEducation:      (id: string) => api.get(`/api/employees/${id}/education`),
  addEducation:      (id: string, data: any) => api.post(`/api/employees/${id}/education`, data),
  updateEducation:   (id: string, rid: string, data: any) => api.put(`/api/employees/${id}/education/${rid}`, data),
  deleteEducation:   (id: string, rid: string) => api.delete(`/api/employees/${id}/education/${rid}`),

  getExperience:     (id: string) => api.get(`/api/employees/${id}/experience`),
  addExperience:     (id: string, data: any) => api.post(`/api/employees/${id}/experience`, data),
  updateExperience:  (id: string, rid: string, data: any) => api.put(`/api/employees/${id}/experience/${rid}`, data),
  deleteExperience:  (id: string, rid: string) => api.delete(`/api/employees/${id}/experience/${rid}`),

  getBankAccounts:   (id: string) => api.get(`/api/employees/${id}/bank-accounts`),
  addBankAccount:    (id: string, data: any) => api.post(`/api/employees/${id}/bank-accounts`, data),
  updateBankAccount: (id: string, aid: string, data: any) => api.put(`/api/employees/${id}/bank-accounts/${aid}`, data),
  deleteBankAccount: (id: string, aid: string) => api.delete(`/api/employees/${id}/bank-accounts/${aid}`),

  getDocuments:      (id: string) => api.get(`/api/employees/${id}/documents`),
  uploadDocument:    (id: string, file: File, type: string, notes?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('documentType', type)
    if (notes) fd.append('notes', notes)
    return api.post(`/api/employees/${id}/documents`, fd)
  },
  verifyDocument:    (id: string, did: string) => api.put(`/api/employees/${id}/documents/${did}/verify`),
  deleteDocument:    (id: string, did: string) => api.delete(`/api/employees/${id}/documents/${did}`),

  getManagers:       () => api.get('/api/employees/managers/list'),
}

// Shared form field component
export function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:border-brand-400 focus:outline-none bg-white'
export const sel = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:border-brand-400 focus:outline-none bg-white'
