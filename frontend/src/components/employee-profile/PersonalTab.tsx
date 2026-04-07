import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Camera, Save } from 'lucide-react'
import { profileApi, Field, inp, sel } from './shared'
import { Button, Alert } from '../ui'
import { DatePicker } from '../DatePicker'

const GENDERS     = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']
const MARITAL     = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']
const BLOOD       = ['A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG']
const STATES_LIST = ['Andhra Pradesh','Assam','Bihar','Chandigarh','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal']

export default function PersonalTab({ emp, isHR, onSaved }: { emp: any; isHR: boolean; onSaved: () => void }) {
  const p   = emp.profile    || {}
  const a   = emp.address    || {}
  const gid = emp.governmentId || {}

  const [profile, setProfile] = useState({
    firstName:    p.firstName    || emp.name?.split(' ')[0] || '',
    lastName:     p.lastName     || emp.name?.split(' ').slice(1).join(' ') || '',
    personalEmail: p.personalEmail || '',
    dateOfBirth:  p.dateOfBirth  ? p.dateOfBirth.slice(0, 10) : '',
    gender:       p.gender       || '',
    maritalStatus: p.maritalStatus || '',
    bloodGroup:   p.bloodGroup   || '',
  })

  const [address, setAddress] = useState({
    currentLine1:   a.currentLine1   || '',
    currentLine2:   a.currentLine2   || '',
    currentCity:    a.currentCity    || '',
    currentState:   a.currentState   || '',
    currentPin:     a.currentPin     || '',
    currentCountry: a.currentCountry || 'India',
    sameAsCurrent:  a.sameAsCurrent  || false,
    permanentLine1: a.permanentLine1 || '',
    permanentLine2: a.permanentLine2 || '',
    permanentCity:  a.permanentCity  || '',
    permanentState: a.permanentState || '',
    permanentPin:   a.permanentPin   || '',
    permanentCountry: a.permanentCountry || 'India',
  })

  const [govId, setGovId] = useState({
    panNumber:      gid.panNumber      || emp.panNumber      || '',
    aadhaarNumber:  gid.aadhaarNumber  || emp.aadhaarNumber  || '',
    passportNumber: gid.passportNumber || emp.passportNumber || '',
    passportExpiry: gid.passportExpiry ? gid.passportExpiry.slice(0, 10) : '',
    uanNumber:      gid.uanNumber      || emp.uanNumber      || '',
    esicNumber:     gid.esicNumber     || emp.esiNumber      || '',
  })

  const [error, setError]   = useState('')
  const [success, setSuccess] = useState('')
  const photoRef            = useRef<HTMLInputElement>(null)

  const profileMut = useMutation({
    mutationFn: () => profileApi.updateProfile(emp.id, profile),
    onSuccess: () => { setSuccess('Personal info saved'); onSaved() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const addressMut = useMutation({
    mutationFn: () => profileApi.updateAddress(emp.id, address),
    onSuccess: () => { setSuccess('Address saved'); onSaved() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const govIdMut = useMutation({
    mutationFn: () => profileApi.updateGovId(emp.id, govId),
    onSuccess: () => { setSuccess('Government IDs saved'); onSaved() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Save failed'),
  })

  const photoMut = useMutation({
    mutationFn: (file: File) => profileApi.uploadPhoto(emp.id, file),
    onSuccess: () => { setSuccess('Photo uploaded'); onSaved() },
    onError:   (e: any) => setError(e?.response?.data?.error || 'Upload failed'),
  })

  function sp(k: string, v: string) { setProfile(prev => ({ ...prev, [k]: v })) }
  function sa(k: string, v: any)    { setAddress(prev => ({ ...prev, [k]: v })) }
  function sg(k: string, v: string) { setGovId(prev => ({ ...prev, [k]: v })) }

  const ro = !isHR  // read-only if not HR

  return (
    <div className="space-y-8">
      {error   && <Alert type="error"   message={error}   />}
      {success && <Alert type="success" message={success} />}

      {/* ── PHOTO ── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Profile Photo</h3>
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-2xl bg-brand-100 flex items-center justify-center overflow-hidden border-2 border-brand-200">
            {emp.profile?.profilePhotoUrl
              ? <img src={emp.profile.profilePhotoUrl} alt={emp.name} className="w-full h-full object-cover"/>
              : <span className="text-4xl font-bold text-brand-600">{emp.name?.charAt(0)?.toUpperCase()}</span>
            }
          </div>
          {isHR && (
            <>
              <input ref={photoRef} type="file" accept="image/*" className="hidden"
                onChange={e => { if (e.target.files?.[0]) photoMut.mutate(e.target.files[0]) }} />
              <Button variant="secondary" icon={<Camera size={14}/>}
                loading={photoMut.isPending}
                onClick={() => photoRef.current?.click()}>
                Upload Photo
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── PERSONAL INFO ── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Personal Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First Name"><input className={inp} value={profile.firstName} disabled={ro} onChange={e => sp('firstName', e.target.value)}/></Field>
          <Field label="Last Name"><input className={inp} value={profile.lastName} disabled={ro} onChange={e => sp('lastName', e.target.value)}/></Field>
          <Field label="Official Email"><input className={inp} value={emp.email} disabled/></Field>
          <Field label="Personal Email"><input className={inp} type="email" value={profile.personalEmail} disabled={ro} onChange={e => sp('personalEmail', e.target.value)}/></Field>
          <Field label="Date of Birth"><DatePicker value={profile.dateOfBirth} disabled={ro} onChange={v => sp('dateOfBirth', v)}/></Field>
          <Field label="Gender">
            <select className={sel} value={profile.gender} disabled={ro} onChange={e => sp('gender', e.target.value)}>
              <option value="">Select...</option>
              {GENDERS.map(g => <option key={g} value={g}>{g.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Marital Status">
            <select className={sel} value={profile.maritalStatus} disabled={ro} onChange={e => sp('maritalStatus', e.target.value)}>
              <option value="">Select...</option>
              {MARITAL.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Blood Group (optional)">
            <select className={sel} value={profile.bloodGroup} disabled={ro} onChange={e => sp('bloodGroup', e.target.value)}>
              <option value="">Select...</option>
              {BLOOD.map(b => <option key={b} value={b}>{b.replace('_', '+').replace('POS', '+').replace('NEG', '-')}</option>)}
            </select>
          </Field>
        </div>
        {isHR && <div className="mt-4 flex justify-end"><Button icon={<Save size={14}/>} loading={profileMut.isPending} onClick={() => { setError(''); setSuccess(''); profileMut.mutate() }}>Save Personal Info</Button></div>}
      </div>

      {/* ── ADDRESS ── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Address</h3>
        <p className="text-xs text-slate-400 mb-3 font-medium uppercase tracking-wide">Current Address</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Address Line 1"><input className={inp} value={address.currentLine1} disabled={ro} onChange={e => sa('currentLine1', e.target.value)}/></Field>
          <Field label="Address Line 2"><input className={inp} value={address.currentLine2} disabled={ro} onChange={e => sa('currentLine2', e.target.value)}/></Field>
          <Field label="City"><input className={inp} value={address.currentCity} disabled={ro} onChange={e => sa('currentCity', e.target.value)}/></Field>
          <Field label="State">
            <select className={sel} value={address.currentState} disabled={ro} onChange={e => sa('currentState', e.target.value)}>
              <option value="">Select...</option>
              {STATES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="PIN Code"><input className={inp} value={address.currentPin} disabled={ro} onChange={e => sa('currentPin', e.target.value)}/></Field>
          <Field label="Country"><input className={inp} value={address.currentCountry} disabled={ro} onChange={e => sa('currentCountry', e.target.value)}/></Field>
        </div>

        {isHR && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input type="checkbox" checked={address.sameAsCurrent} onChange={e => sa('sameAsCurrent', e.target.checked)} className="w-4 h-4 rounded"/>
            <span className="text-sm text-slate-600">Permanent address same as current</span>
          </label>
        )}

        {!address.sameAsCurrent && (
          <>
            <p className="text-xs text-slate-400 mb-3 font-medium uppercase tracking-wide">Permanent Address</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Field label="Address Line 1"><input className={inp} value={address.permanentLine1} disabled={ro} onChange={e => sa('permanentLine1', e.target.value)}/></Field>
              <Field label="Address Line 2"><input className={inp} value={address.permanentLine2} disabled={ro} onChange={e => sa('permanentLine2', e.target.value)}/></Field>
              <Field label="City"><input className={inp} value={address.permanentCity} disabled={ro} onChange={e => sa('permanentCity', e.target.value)}/></Field>
              <Field label="State">
                <select className={sel} value={address.permanentState} disabled={ro} onChange={e => sa('permanentState', e.target.value)}>
                  <option value="">Select...</option>
                  {STATES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="PIN Code"><input className={inp} value={address.permanentPin} disabled={ro} onChange={e => sa('permanentPin', e.target.value)}/></Field>
              <Field label="Country"><input className={inp} value={address.permanentCountry} disabled={ro} onChange={e => sa('permanentCountry', e.target.value)}/></Field>
            </div>
          </>
        )}
        {isHR && <div className="flex justify-end"><Button icon={<Save size={14}/>} loading={addressMut.isPending} onClick={() => { setError(''); setSuccess(''); addressMut.mutate() }}>Save Address</Button></div>}
      </div>

      {/* ── GOVERNMENT IDS ── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Government & Compliance IDs</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="PAN Number"><input className={inp} placeholder="ABCDE1234F" value={govId.panNumber} disabled={ro} onChange={e => sg('panNumber', e.target.value.toUpperCase())}/></Field>
          <Field label="Aadhaar Number">
            <input className={inp} placeholder="XXXX XXXX XXXX"
              value={govId.aadhaarNumber ? (ro ? '****' + govId.aadhaarNumber.slice(-4) : govId.aadhaarNumber) : ''}
              disabled={ro} onChange={e => sg('aadhaarNumber', e.target.value.replace(/\s/g, ''))}/>
          </Field>
          <Field label="UAN (PF)"><input className={inp} value={govId.uanNumber} disabled={ro} onChange={e => sg('uanNumber', e.target.value)}/></Field>
          <Field label="ESIC Number"><input className={inp} value={govId.esicNumber} disabled={ro} onChange={e => sg('esicNumber', e.target.value)}/></Field>
          <Field label="Passport Number"><input className={inp} value={govId.passportNumber} disabled={ro} onChange={e => sg('passportNumber', e.target.value.toUpperCase())}/></Field>
          <Field label="Passport Expiry"><DatePicker value={govId.passportExpiry} disabled={ro} onChange={v => sg('passportExpiry', v)}/></Field>
        </div>
        {isHR && <div className="mt-4 flex justify-end"><Button icon={<Save size={14}/>} loading={govIdMut.isPending} onClick={() => { setError(''); setSuccess(''); govIdMut.mutate() }}>Save IDs</Button></div>}
      </div>
    </div>
  )
}
