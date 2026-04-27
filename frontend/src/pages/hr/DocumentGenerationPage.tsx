import { useState, useRef, useCallback, useEffect, forwardRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { employeeApi, configApi, documentsApi } from '../../services/api'
import { Upload, RefreshCw, Send, Save, Mail, X, CheckCircle, AlertCircle } from 'lucide-react'
import { DatePicker } from '../../components/DatePicker'
import { format } from 'date-fns'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface SalaryData {
  annualCtc: number
  basicMonthly: number
  hraMonthly: number
  transportMonthly: number
  fbpMonthly: number
  hyiMonthly: number
  grandTotalMonthly: number
  employeePfMonthly: number
  employeeEsiMonthly: number
  employerPfMonthly: number
  employerEsiMonthly: number
  ptMonthly: number
  netMonthly: number
  esiApplies: boolean
  annualBonus: number
  mediclaim: number
}

interface CompanyProfile {
  COMPANY_NAME?: string
  COMPANY_ADDRESS?: string
  COMPANY_WEBSITE?: string
  COMPANY_PHONE?: string
  COMPANY_EMAIL?: string
  COMPANY_LOGO_URL?: string
  COMPANY_SIGN_URL?: string
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

function buildIncrementLetterHtml(
  emp: any,
  salary: SalaryData,
  letterDate: string,
  effectiveDate: string,
  isPromotion: boolean,
  newDesignation: string,
  company: CompanyProfile,
  signerName: string,
  signerDesignation: string,
): string {
  const logoHtml = company.COMPANY_LOGO_URL
    ? `<img src="${company.COMPANY_LOGO_URL}" alt="logo" style="height:55px;width:auto;" />`
    : `<span style="font-size:20px;font-weight:700;color:#1a237e;">${company.COMPANY_NAME || 'CSharpTek'}</span>`

  const formattedLetterDate = letterDate
    ? format(new Date(letterDate), 'dd MMMM yyyy')
    : ''
  const formattedEffDate = effectiveDate
    ? format(new Date(effectiveDate), 'dd MMMM yyyy')
    : ''

  const promotionPara = isPromotion && newDesignation
    ? `<p style="margin:10px 0;font-size:11pt;">We are also pleased to inform you that you have been promoted to the position of <strong>${newDesignation}</strong>, effective the same date.</p>`
    : ''

  // Annual CTC breakup table
  const annualBasic     = salary.basicMonthly * 12
  const annualHra       = salary.hraMonthly * 12
  const annualTransport = salary.transportMonthly * 12
  const annualFbp       = salary.fbpMonthly * 12
  const annualHyi       = salary.hyiMonthly * 12
  const annualEmpPf     = salary.employerPfMonthly * 12
  const annualMediclaim = salary.mediclaim * 12

  const tableStyle = 'width:100%;border-collapse:collapse;font-size:10pt;margin:10px 0;'
  const thStyle    = 'border:1px solid #ccc;padding:6px 8px;background:#f5f5f5;text-align:left;font-weight:600;'
  const tdStyle    = 'border:1px solid #ccc;padding:5px 8px;'
  const tdRStyle   = 'border:1px solid #ccc;padding:5px 8px;text-align:right;'
  const tfStyle    = 'border:1px solid #ccc;padding:5px 8px;background:#eeeeee;font-weight:700;'
  const tfRStyle   = 'border:1px solid #ccc;padding:5px 8px;background:#eeeeee;font-weight:700;text-align:right;'

  const annualTable = `
    <table style="${tableStyle}">
      <thead>
        <tr><th style="${thStyle}">Component</th><th style="${thStyle}" align="right">Annual (₹)</th></tr>
      </thead>
      <tbody>
        <tr><td style="${tdStyle}">Basic Salary</td><td style="${tdRStyle}">${fmt(annualBasic)}</td></tr>
        <tr><td style="${tdStyle}">House Rent Allowance (HRA)</td><td style="${tdRStyle}">${fmt(annualHra)}</td></tr>
        <tr><td style="${tdStyle}">Transport Allowance</td><td style="${tdRStyle}">${fmt(annualTransport)}</td></tr>
        <tr><td style="${tdStyle}">Flexible Benefit Plan (FBP)</td><td style="${tdRStyle}">${fmt(annualFbp)}</td></tr>
        <tr><td style="${tdStyle}">Half Yearly Incentive (HYI)</td><td style="${tdRStyle}">${fmt(annualHyi)}</td></tr>
        <tr><td style="${tdStyle}">Annual Bonus</td><td style="${tdRStyle}">${fmt(salary.annualBonus)}</td></tr>
        <tr><td style="${tdStyle}">Employer PF Contribution</td><td style="${tdRStyle}">${fmt(annualEmpPf)}</td></tr>
        <tr><td style="${tdStyle}">Mediclaim</td><td style="${tdRStyle}">${fmt(annualMediclaim)}</td></tr>
        <tr><td style="${tfStyle}">Total CTC</td><td style="${tfRStyle}">${fmt(salary.annualCtc)}</td></tr>
      </tbody>
    </table>`

  const monthlyTable = `
    <table style="${tableStyle}">
      <thead>
        <tr>
          <th style="${thStyle}">Earnings</th>
          <th style="${thStyle}" align="right">Amount (₹)</th>
          <th style="${thStyle}">Deductions</th>
          <th style="${thStyle}" align="right">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${tdStyle}">Basic Salary</td><td style="${tdRStyle}">${fmt(salary.basicMonthly)}</td>
          <td style="${tdStyle}">Employee PF</td><td style="${tdRStyle}">${fmt(salary.employeePfMonthly)}</td>
        </tr>
        <tr>
          <td style="${tdStyle}">HRA</td><td style="${tdRStyle}">${fmt(salary.hraMonthly)}</td>
          <td style="${tdStyle}">${salary.esiApplies ? 'Employee ESI' : 'Professional Tax'}</td>
          <td style="${tdRStyle}">${fmt(salary.esiApplies ? salary.employeeEsiMonthly : salary.ptMonthly)}</td>
        </tr>
        <tr>
          <td style="${tdStyle}">Transport Allowance</td><td style="${tdRStyle}">${fmt(salary.transportMonthly)}</td>
          <td style="${tdStyle}"></td><td style="${tdRStyle}"></td>
        </tr>
        <tr>
          <td style="${tdStyle}">FBP</td><td style="${tdRStyle}">${fmt(salary.fbpMonthly)}</td>
          <td style="${tdStyle}"></td><td style="${tdRStyle}"></td>
        </tr>
        <tr>
          <td style="${tdStyle}">Half Yearly Incentive</td><td style="${tdRStyle}">${fmt(salary.hyiMonthly)}</td>
          <td style="${tdStyle}"></td><td style="${tdRStyle}"></td>
        </tr>
        <tr>
          <td style="${tfStyle}">Total Earnings</td><td style="${tfRStyle}">${fmt(salary.grandTotalMonthly)}</td>
          <td style="${tfStyle}">Total Deductions</td>
          <td style="${tfRStyle}">${fmt(salary.employeePfMonthly + (salary.esiApplies ? salary.employeeEsiMonthly : salary.ptMonthly))}</td>
        </tr>
        <tr>
          <td style="${tfStyle}" colspan="2">Net Monthly Salary</td>
          <td style="${tfRStyle}" colspan="2">${fmt(salary.netMonthly)}</td>
        </tr>
      </tbody>
    </table>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/>
<style>
  @page { margin: 15mm 20mm 20mm 20mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #222; margin: 0; padding: 0; }
  .page { max-width: 800px; margin: 0 auto; padding: 20px 30px; }
  .header-table { width: 100%; border-collapse: collapse; border-bottom: 2px solid #823b0b; padding-bottom: 8px; margin-bottom: 16px; }
  .footer { border-top: 3px double #823b0b; text-align: center; font-size: 9pt; font-weight: 700; margin-top: 30px; padding-top: 6px; color: #222; }
  .disclaimer { margin-top: 24px; padding: 8px 12px; border-top: 1px solid #ddd; font-size: 8pt; color: #666; text-align: center; font-style: italic; }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <table class="header-table">
    <tr>
      <td style="width:50%;vertical-align:middle;">${logoHtml}</td>
      <td style="width:50%;vertical-align:top;text-align:right;font-size:9pt;color:#333;">
        ${company.COMPANY_ADDRESS || '199/A Mandaliya Nagar, Near Panchwati Garden Lane, Bariatu, Ranchi, Jharkhand'}<br/>
        Website: ${company.COMPANY_WEBSITE || 'www.csharptek.com'}<br/>
        Phone: ${company.COMPANY_PHONE || '+91-9334646668'}
      </td>
    </tr>
  </table>

  <!-- TITLE -->
  <p style="text-align:center;font-size:14pt;font-weight:700;text-decoration:underline;margin:16px 0;">Increment Letter</p>

  <!-- DATE & GREETING -->
  <table style="width:100%;margin-bottom:12px;">
    <tr>
      <td><strong>Dear ${emp.name?.split(' ')[0] || emp.name},</strong></td>
      <td style="text-align:right;"><strong>Date: ${formattedLetterDate}</strong></td>
    </tr>
  </table>

  <!-- BODY -->
  <p style="margin:10px 0;font-size:11pt;">
    We are pleased to inform you that your Annual CTC has been revised to
    <strong>Rs. ${fmt(salary.annualCtc)}</strong> (Rupees ${numberToWords(salary.annualCtc)} Only),
    effective from <strong>${formattedEffDate}</strong>.
  </p>

  ${promotionPara}

  <p style="margin:14px 0 6px;font-size:11pt;font-weight:600;">Annual CTC Breakup:</p>
  ${annualTable}

  <p style="margin:14px 0 6px;font-size:11pt;font-weight:600;">Monthly Salary Breakup:</p>
  ${monthlyTable}

  <p style="margin:16px 0 4px;font-size:11pt;">
    We appreciate your contributions and look forward to your continued association with the organisation.
  </p>

  <!-- SIGNATURE -->
  <div style="margin-top:40px;">
    ${company.COMPANY_SIGN_URL ? `<img src="${company.COMPANY_SIGN_URL}" alt="sign" style="height:60px;width:auto;margin-bottom:4px;" />` : ''}
    <p style="margin:0;font-size:11pt;">For <strong>${company.COMPANY_NAME || 'Cloudgarner Solutions Pvt. Ltd.'}</strong></p>
    <br/><br/>
    <p style="margin:0;font-size:11pt;font-weight:700;">${signerName}</p>
    <p style="margin:0;font-size:10pt;">${signerDesignation}</p>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div>${company.COMPANY_NAME || 'Cloudgarner Solutions Pvt. Ltd.'}</div>
    <div>${company.COMPANY_ADDRESS || '199/A, Mandaliya Nagar, Panchwati Garden Lane, Bariatu, Ranchi, Jharkhand – 834009'}</div>
    <div>Website: ${company.COMPANY_WEBSITE || 'www.cloudgarner.com'} | Email: ${company.COMPANY_EMAIL || 'support@cloudgarner.com'} | Phone: ${company.COMPANY_PHONE || '9334646668'}</div>
  </div>

  <!-- DISCLAIMER -->
  <div class="disclaimer">
    This is a system-generated document and does not require a physical signature.
    For verification, contact <a href="mailto:hr@csharptek.com" style="color:#666;">hr@csharptek.com</a> or visit <a href="https://www.csharptek.com" style="color:#666;">www.csharptek.com</a>
  </div>

</div>
</body>
</html>`
}

// Simple number to words for Indian amounts
function numberToWords(n: number): string {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  function convert(num: number): string {
    if (num === 0) return ''
    if (num < 20) return ones[num] + ' '
    if (num < 100) return tens[Math.floor(num/10)] + ' ' + (num%10 ? ones[num%10] + ' ' : '')
    if (num < 1000) return ones[Math.floor(num/100)] + ' Hundred ' + convert(num%100)
    if (num < 100000) return convert(Math.floor(num/1000)) + 'Thousand ' + convert(num%1000)
    if (num < 10000000) return convert(Math.floor(num/100000)) + 'Lakh ' + convert(num%100000)
    return convert(Math.floor(num/10000000)) + 'Crore ' + convert(num%10000000)
  }
  const amt = Math.round(n)
  return convert(amt).trim() || 'Zero'
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function DocumentGenerationPage() {
  const [empSearch, setEmpSearch] = useState('')
  const [empDropOpen, setEmpDropOpen] = useState(false)
  const [selectedEmp, setSelectedEmp] = useState<any>(null)
  const [docType, setDocType] = useState('INCREMENT_LETTER')
  const [letterDate, setLetterDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [effectiveDate, setEffectiveDate] = useState('2026-04-01')
  const [ctcOverride, setCtcOverride] = useState('')
  const [isPromotion, setIsPromotion] = useState(false)
  const [newDesignation, setNewDesignation] = useState('')
  const [salary, setSalary] = useState<SalaryData | null>(null)
  const [signerName, setSignerName] = useState('')
  const [signerDesignation, setSignerDesignation] = useState('')
  const [signerLoaded, setSignerLoaded] = useState(false)
  const [htmlContent, setHtmlContent] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [signFile, setSignFile] = useState<File | null>(null)
  const [companyForm, setCompanyForm] = useState<CompanyProfile>({})
  const [companySaved, setCompanySaved] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailSubjectOverride, setEmailSubjectOverride] = useState('')
  const [testEmailAddr, setTestEmailAddr] = useState('')
  const [emailStatus, setEmailStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Employees list
  const { data: empData } = useQuery({
    queryKey: ['employees-list'],
    queryFn:  () => employeeApi.list({ status: 'ACTIVE', limit: 500 }).then(r => r.data.data),
  })

  // Config (company profile)
  const { data: configData, refetch: refetchConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn:  () => configApi.get().then(r => r.data?.data || {}),
  })

  // Populate company form when config loads
  useEffect(() => {
    if (!configData) return
    const d = configData as any
    setCompanyForm({
      COMPANY_NAME:     d.COMPANY_NAME     || '',
      COMPANY_ADDRESS:  d.COMPANY_ADDRESS  || '',
      COMPANY_WEBSITE:  d.COMPANY_WEBSITE  || '',
      COMPANY_PHONE:    d.COMPANY_PHONE    || '',
      COMPANY_EMAIL:    d.COMPANY_EMAIL    || '',
      COMPANY_LOGO_URL: d.COMPANY_LOGO_URL || '',
      COMPANY_SIGN_URL:  d.COMPANY_SIGN_URL  || '',
    })
    // Load signer only once — never overwrite user changes
    if (!signerLoaded) {
      setSignerName(d.INCREMENT_SIGNER_NAME || 'Bhanu Pratap Gupta')
      setSignerDesignation(d.INCREMENT_SIGNER_DESIGNATION || 'CEO')
      setSignerLoaded(true)
    }
  }, [configData])

  // Snapshot load when employee selected
  const { mutate: loadSnapshot, isLoading: snapshotLoading } = useMutation({
    mutationFn: (id: string) => documentsApi.getSalarySnapshot(id),
    onSuccess: (r) => {
      const s = r.data?.data
      if (s) {
        setSalary({
          annualCtc:          Number(s.annualCtc),
          basicMonthly:       Number(s.basicMonthly),
          hraMonthly:         Number(s.hraMonthly),
          transportMonthly:   Number(s.transportMonthly),
          fbpMonthly:         Number(s.fbpMonthly),
          hyiMonthly:         Number(s.hyiMonthly),
          grandTotalMonthly:  Number(s.grandTotalMonthly),
          employeePfMonthly:  Number(s.employeePfMonthly),
          employeeEsiMonthly: Number(s.employeeEsiMonthly),
          employerPfMonthly:  Number(s.employerPfMonthly),
          employerEsiMonthly: Number(s.employerEsiMonthly),
          ptMonthly:          Number(s.ptMonthly),
          netMonthly:         Number(s.netMonthly),
          esiApplies:         s.esiApplies,
          annualBonus:        Number(s.annualBonus),
          mediclaim:          Number(s.mediclaim),
        })
        setCtcOverride(String(Number(s.annualCtc)))
      }
    },
  })

  // Compute salary on CTC override
  const { mutate: computeSalary, isLoading: computing } = useMutation({
    mutationFn: (ctc: number) => documentsApi.computeSalary({ employeeId: selectedEmp.id, annualCtc: ctc }),
    onSuccess: (r) => {
      const s = r.data?.data
      if (s) setSalary(s)
    },
  })

  // Save company profile
  const { mutate: saveCompany, isLoading: savingCompany } = useMutation({
    mutationFn: async () => {
      if (logoFile) {
        const fd = new FormData()
        fd.append('logo', logoFile)
        await documentsApi.uploadLogo(fd)
      }
      if (signFile) {
        const fd = new FormData()
        fd.append('logo', signFile)
        const r = await documentsApi.uploadSign(fd)
        setCompanyForm(p => ({ ...p, COMPANY_SIGN_URL: r.data?.data?.url || '' }))
      }
      await configApi.update(companyForm)
      await refetchConfig()
    },
    onSuccess: () => setCompanySaved(true),
  })

  // Save signer as default
  const { mutate: saveSigner, isLoading: savingSigner } = useMutation({
    mutationFn: () => configApi.update({
      INCREMENT_SIGNER_NAME: signerName,
      INCREMENT_SIGNER_DESIGNATION: signerDesignation,
    }),
  })

  // Send email mutation
  const { mutate: sendEmailMutation, isLoading: sendingEmail } = useMutation({
    mutationFn: () => documentsApi.sendEmail({
      employeeId: selectedEmp.id,
      htmlContent,
      subject: emailSubjectOverride || undefined,
    }),
    onSuccess: () => {
      setEmailStatus({ type: 'success', msg: `Email sent to ${selectedEmp?.email}` })
    },
    onError: (e: any) => {
      setEmailStatus({ type: 'error', msg: e?.response?.data?.error || 'Failed to send email' })
    },
  })

  // Test email mutation
  const { mutate: sendTestEmailMutation, isLoading: sendingTestEmail } = useMutation({
    mutationFn: () => documentsApi.testEmail({
      toEmail: testEmailAddr,
      employeeId: selectedEmp?.id,
      htmlContent: htmlContent || undefined,
    }),
    onSuccess: () => {
      setEmailStatus({ type: 'success', msg: `Test email sent to ${testEmailAddr}` })
    },
    onError: (e: any) => {
      setEmailStatus({ type: 'error', msg: e?.response?.data?.error || 'Failed to send test email' })
    },
  })

  // Generate document
  const { mutate: generateDoc, isLoading: generating } = useMutation({
    mutationFn: () => {
      const html = buildIncrementLetterHtml(
        selectedEmp, salary!, letterDate, effectiveDate,
        isPromotion, newDesignation,
        { ...companyForm, COMPANY_LOGO_URL: configData?.COMPANY_LOGO_URL || companyForm.COMPANY_LOGO_URL },
        signerName, signerDesignation,
      )
      setHtmlContent(html)
      setShowPreview(true)
      return documentsApi.generate({
        employeeId: selectedEmp.id,
        documentType: docType,
        letterDate, effectiveDate,
        isPromotion, newDesignation,
        salaryData: salary,
        htmlContent: html,
        sendEmailFlag: false,
      })
    },
  })

  const filteredEmps = (Array.isArray(empData) ? empData : []).filter((e: any) =>
    e.name?.toLowerCase().includes(empSearch.toLowerCase()) ||
    e.employeeCode?.toLowerCase().includes(empSearch.toLowerCase())
  )

  const handleSelectEmp = (emp: any) => {
    setSelectedEmp(emp)
    setEmpSearch(emp.name)
    setEmpDropOpen(false)
    setSalary(null)
    setCtcOverride('')
    loadSnapshot(emp.id)
  }

  const handleCtcBlur = () => {
    const val = parseFloat(ctcOverride)
    if (!isNaN(val) && val > 0 && selectedEmp) computeSalary(val)
  }

  const handlePrint = () => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.print()
    } else {
      const win = window.open('', '_blank')
      if (!win) return
      win.document.write(htmlContent)
      win.document.close()
      win.print()
    }
  }

  const company = companyForm

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Increment Letter</h1>

      {/* ── COMPANY PROFILE ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Company Profile</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Company Name">
            <input className={inp} value={company.COMPANY_NAME || ''} onChange={e => setCompanyForm(p => ({ ...p, COMPANY_NAME: e.target.value }))} />
          </Field>
          <Field label="Website">
            <input className={inp} value={company.COMPANY_WEBSITE || ''} onChange={e => setCompanyForm(p => ({ ...p, COMPANY_WEBSITE: e.target.value }))} />
          </Field>
          <Field label="Address">
            <input className={inp} value={company.COMPANY_ADDRESS || ''} onChange={e => setCompanyForm(p => ({ ...p, COMPANY_ADDRESS: e.target.value }))} />
          </Field>
          <Field label="Phone">
            <input className={inp} value={company.COMPANY_PHONE || ''} onChange={e => setCompanyForm(p => ({ ...p, COMPANY_PHONE: e.target.value }))} />
          </Field>
          <Field label="Email">
            <input className={inp} value={company.COMPANY_EMAIL || ''} onChange={e => setCompanyForm(p => ({ ...p, COMPANY_EMAIL: e.target.value }))} />
          </Field>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              {(company.COMPANY_LOGO_URL) && (
                <img src={company.COMPANY_LOGO_URL} alt="logo" className="h-10 w-auto border rounded" />
              )}
              <label className="cursor-pointer flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <Upload size={14} />
                {logoFile ? logoFile.name : 'Upload Logo'}
                <input type="file" accept="image/*" className="hidden" onChange={e => setLogoFile(e.target.files?.[0] || null)} />
              </label>
            </div>
          </Field>
          <Field label="Signature / Stamp (optional)">
            <div className="flex items-center gap-3">
              {(company.COMPANY_SIGN_URL) && (
                <img src={company.COMPANY_SIGN_URL} alt="sign" className="h-10 w-auto border rounded" />
              )}
              <label className="cursor-pointer flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <Upload size={14} />
                {signFile ? signFile.name : 'Upload Sign/Stamp'}
                <input type="file" accept="image/*" className="hidden" onChange={e => setSignFile(e.target.files?.[0] || null)} />
              </label>
              {company.COMPANY_SIGN_URL && (
                <span className="text-xs text-slate-400 italic">Document will not show signature (system-generated)</span>
              )}
            </div>
          </Field>
        </div>
        <button
          onClick={() => saveCompany()}
          disabled={savingCompany}
          className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {savingCompany ? 'Saving…' : companySaved ? '✓ Saved' : 'Save Company Profile'}
        </button>
      </section>

      {/* ── GENERATION FORM ── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Generate Document</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Employee Search */}
          <Field label="Employee" className="relative">
            <div className="relative">
              <input
                className={inp}
                placeholder="Search by name or code…"
                value={empSearch}
                onChange={e => { setEmpSearch(e.target.value); setEmpDropOpen(true) }}
                onFocus={() => setEmpDropOpen(true)}
              />
              {empDropOpen && filteredEmps.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto text-sm">
                  {filteredEmps.slice(0, 20).map((e: any) => (
                    <li
                      key={e.id}
                      className="px-3 py-2 hover:bg-blue-50 cursor-pointer"
                      onMouseDown={() => handleSelectEmp(e)}
                    >
                      <span className="font-medium">{e.name}</span>
                      <span className="text-gray-400 ml-2">{e.employeeCode}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>

          {/* Document Type */}
          <Field label="Document Type">
            <select className={inp} value={docType} onChange={e => setDocType(e.target.value)}>
              <option value="INCREMENT_LETTER">Increment Letter</option>
            </select>
          </Field>

          {/* Letter Date */}
          <Field label="Letter Date">
            <DatePicker value={letterDate} onChange={setLetterDate} placeholder="Select letter date" />
          </Field>

          {/* Effective Date */}
          <Field label="Effective Date">
            <DatePicker value={effectiveDate} onChange={setEffectiveDate} placeholder="Select effective date" />
          </Field>

          {/* CTC */}
          <Field label="Annual CTC (₹)">
            <div className="flex gap-2">
              <input
                type="number"
                className={inp}
                value={ctcOverride}
                onChange={e => setCtcOverride(e.target.value)}
                onBlur={handleCtcBlur}
                placeholder={snapshotLoading ? 'Loading…' : 'Enter CTC'}
              />
              {computing && <RefreshCw size={16} className="self-center animate-spin text-blue-500" />}
            </div>
          </Field>

          {/* Promotion */}
          <Field label="Promotion">
            <div className="flex items-center gap-4 h-10">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={!isPromotion} onChange={() => setIsPromotion(false)} /> No
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" checked={isPromotion} onChange={() => setIsPromotion(true)} /> Yes
              </label>
            </div>
          </Field>

          {/* New Designation */}
          {isPromotion && (
            <Field label="New Designation">
              <input className={inp} placeholder="e.g. Senior Developer" value={newDesignation} onChange={e => setNewDesignation(e.target.value)} />
            </Field>
          )}
          {/* Signer */}
          <Field label="Signed By">
            <input className={inp} value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="e.g. Bhanu Pratap Gupta" />
          </Field>
          <Field label="Signer Designation">
            <div className="flex gap-2">
              <input className={inp} value={signerDesignation} onChange={e => setSignerDesignation(e.target.value)} placeholder="e.g. CEO" />
              <button
                onClick={() => saveSigner()}
                disabled={savingSigner || !signerName}
                className="px-3 py-2 text-xs bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                title="Save signer as default"
              >
                {savingSigner ? '…' : 'Save Default'}
              </button>
            </div>
          </Field>
        </div>

        {/* Salary Breakup Preview */}
        {salary && (
          <div className="mt-5 border border-gray-100 rounded-lg p-4 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Salary Breakup Preview</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[
                ['Basic', salary.basicMonthly],
                ['HRA', salary.hraMonthly],
                ['Transport', salary.transportMonthly],
                ['FBP', salary.fbpMonthly],
                ['HYI', salary.hyiMonthly],
                ['Gross Monthly', salary.grandTotalMonthly],
                ['Employee PF', salary.employeePfMonthly],
                [salary.esiApplies ? 'ESI' : 'Prof. Tax', salary.esiApplies ? salary.employeeEsiMonthly : salary.ptMonthly],
                ['Net Monthly', salary.netMonthly],
              ].map(([label, val]) => (
                <div key={String(label)} className="bg-white rounded p-2 border border-gray-200">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="font-semibold text-gray-800">₹{fmt(Number(val))}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => {
              const html = buildIncrementLetterHtml(
                selectedEmp, salary!, letterDate, effectiveDate,
                isPromotion, newDesignation,
                { ...companyForm, COMPANY_LOGO_URL: configData?.COMPANY_LOGO_URL || companyForm.COMPANY_LOGO_URL },
                signerName, signerDesignation,
              )
              setHtmlContent(html)
              setShowPreview(true)
            }}
            disabled={!selectedEmp || !salary || !effectiveDate}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-40"
          >
            Preview Letter
          </button>
          <button
            onClick={() => generateDoc()}
            disabled={!selectedEmp || !salary || !effectiveDate || generating}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40"
          >
            <Save size={14} /> {generating ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => {
              if (!htmlContent) {
                const html = buildIncrementLetterHtml(
                  selectedEmp, salary!, letterDate, effectiveDate,
                  isPromotion, newDesignation,
                  { ...companyForm, COMPANY_LOGO_URL: configData?.COMPANY_LOGO_URL || companyForm.COMPANY_LOGO_URL },
                  signerName, signerDesignation,
                )
                setHtmlContent(html)
                setShowPreview(true)
              }
              setEmailStatus(null)
              setShowEmailModal(true)
            }}
            disabled={!selectedEmp || !salary || !effectiveDate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40"
          >
            <Mail size={14} /> Email to Employee
          </button>
        </div>
      </section>

      {showPreview && htmlContent && (
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Letter Preview</h2>
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 text-sm bg-gray-700 text-white rounded hover:bg-gray-800"
            >
              Print / Download PDF
            </button>
          </div>
          <IframeEditor
            ref={iframeRef}
            html={htmlContent}
            onChange={setHtmlContent}
          />
        </section>
      )}

      {/* ── EMAIL MODAL ── */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Mail size={18} className="text-blue-600" />
                <h3 className="text-base font-semibold text-gray-800">Email Increment Letter</h3>
              </div>
              <button onClick={() => setShowEmailModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Employee Info */}
              <div className="bg-blue-50 rounded-lg p-3 text-sm">
                <p className="font-medium text-blue-900">{selectedEmp?.name}</p>
                <p className="text-blue-600">{selectedEmp?.employeeCode} · {selectedEmp?.email || <span className="text-red-500">No email on record</span>}</p>
              </div>

              {/* Email Subject */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email Subject</label>
                <input
                  className={inp}
                  value={emailSubjectOverride}
                  onChange={e => setEmailSubjectOverride(e.target.value)}
                  placeholder="Leave blank to use template from Settings"
                />
                <p className="text-xs text-gray-400 mt-1">Configure default in Notification Settings → Increment Letter</p>
              </div>

              {/* Letter Preview inside modal */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Letter Preview</label>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <iframe
                    srcDoc={htmlContent}
                    style={{ width: '100%', height: 320, border: 'none' }}
                    title="email-preview"
                  />
                </div>
              </div>

              {/* Status */}
              {emailStatus && (
                <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${emailStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {emailStatus.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {emailStatus.msg}
                </div>
              )}

              {/* Test Email */}
              <div className="border border-gray-200 rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Send Test Email</p>
                <div className="flex gap-2">
                  <input
                    className={`${inp} flex-1`}
                    placeholder="your@email.com"
                    value={testEmailAddr}
                    onChange={e => setTestEmailAddr(e.target.value)}
                  />
                  <button
                    onClick={() => { setEmailStatus(null); sendTestEmailMutation() }}
                    disabled={!testEmailAddr || sendingTestEmail}
                    className="px-3 py-2 text-sm bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40 whitespace-nowrap"
                  >
                    {sendingTestEmail ? 'Sending…' : 'Send Test'}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setShowEmailModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => { setEmailStatus(null); sendEmailMutation() }}
                disabled={!selectedEmp?.email || sendingEmail}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                <Send size={14} />
                {sendingEmail ? 'Sending…' : `Send to ${selectedEmp?.email || 'employee'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── IFRAME EDITOR ───────────────────────────────────────────────────────────
// Using iframe avoids the contentEditable + dangerouslySetInnerHTML focus bug.
// The iframe document is made editable via designMode; no React re-render on keypress.


const IframeEditor = forwardRef<HTMLIFrameElement, { html: string; onChange: (h: string) => void }>(
  ({ html, onChange }, ref) => {
    const localRef = useRef<HTMLIFrameElement>(null)
    const initialHtml = useRef(html)
    const initialized = useRef(false)

    const combinedRef = (el: HTMLIFrameElement | null) => {
      localRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as any).current = el
    }

    // Write content once on mount via blank src + useEffect
    useEffect(() => {
      if (initialized.current) return
      const iframe = localRef.current
      if (!iframe) return
      const doc = iframe.contentDocument
      if (!doc) return
      initialized.current = true
      doc.open()
      doc.write(initialHtml.current)
      doc.close()
      doc.designMode = 'on'
      doc.addEventListener('input', () => {
        onChange(doc.documentElement.outerHTML)
      })
    }, [onChange])

    // Never pass srcDoc - use blank src so React never reloads the iframe
    return (
      <iframe
        ref={combinedRef}
        src="about:blank"
        style={{ width: '100%', minHeight: 700, border: 'none' }}
        title="letter-editor"
      />
    )
  }
)
IframeEditor.displayName = 'IframeEditor'

// ─── TINY COMPONENTS ─────────────────────────────────────────────────────────

const inp = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
