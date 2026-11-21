// @vitest-environment jsdom
const storageMap = new Map<string, string>()
const mockStorage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => storageMap.set(k, String(v)),
  removeItem: (k: string) => storageMap.delete(k),
  clear: () => storageMap.clear(),
  get length() { return storageMap.size },
  key: (i: number) => Array.from(storageMap.keys())[i] ?? null
}
Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true })
import{afterEach,describe,expect,it}from'vitest'
import{cleanup,fireEvent,render,screen}from'@testing-library/react'
import{MemoryRouter}from'react-router-dom'
import Login from'../src/pages/Login'
import Shell from'../src/layouts/Shell'
import{Foods,Dashboard,Chat,Planner}from'../src/pages/Patient'
import{AnatomyVisualizer}from'../src/components/Anatomy3DVisualizer'
import{set,get,login,addMedicalRecord,reset,applyPresetMedicalRecord}from'../src/services/store'
afterEach(cleanup)
describe('UI',()=>{
it('shows an error for a wrong password',()=>{render(<Login/>);fireEvent.change(screen.getByLabelText('Mật khẩu'),{target:{value:'Sai12345!'}});fireEvent.click(screen.getByText('Đăng nhập',{selector:'button'}));expect(screen.getByRole('alert').textContent).toContain('không đúng')})
it('validates email format',()=>{render(<Login/>);fireEvent.change(screen.getByLabelText('Email'),{target:{value:'abc'}});fireEvent.click(screen.getByText('Đăng nhập',{selector:'button'}));expect(screen.getByRole('alert').textContent).toContain('Email không hợp lệ')})
it('filters foods by name',()=>{render(<Foods/>);fireEvent.change(screen.getByLabelText('Tìm thực phẩm'),{target:{value:'Gạo'}});expect(screen.getByText('Gạo lứt')).toBeTruthy();expect(screen.queryByText('Táo tây')).toBeNull()})
it('shows empty state when nothing matches',()=>{render(<Foods/>);fireEvent.change(screen.getByLabelText('Tìm thực phẩm'),{target:{value:'zzzz'}});expect(screen.getByText(/Không tìm thấy/)).toBeTruthy()})
it('persists data and blocks locked accounts',()=>{set(d=>{d.users.find(u=>u.email==='patient@demo.vn')!.active=false});expect(window.localStorage.getItem('ainp_v4')).toContain('"active":false');expect(login('patient@demo.vn','Demo123!')).toContain('khóa');expect(get().session).toBeNull()})
it('deduplicates noisy conditions and avoids duplicate medication parentheses on Dashboard',()=>{
  set(d=>{d.users.find(u=>u.id==='u1')!.active=true})
  login('patient@demo.vn','Demo123!')
  addMedicalRecord({
    id:'rec-clean-ui',
    name:'Ho_So_Benh_An_Test.docx',
    date:'2026-11-20',
    type:'Bệnh án test',
    metrics:[],
    diseases:[
      'Ho So Benh An_Test.docx',
      'XÁC ĐỊNH (ICD-10 CLINICAL DIAGNOSIS)',
      'Lâm sàng Xác định',
      'CHẨN ĐOÁN',
      'Tăng huyết áp độ 2',
      'tăng huyết áp độ 2',
      'GERD',
      'Gout'
    ],
    allergies:[],
    medications:[
      {name:'Metformin',activeIngredient:'Metformin',dosage:'850mg',purpose:'Đái tháo đường'},
      {name:'Zyloric (Allopurinol)',activeIngredient:'Allopurinol',dosage:'300mg',purpose:'Gout'}
    ],
    has_conflict:false,
    organ_mappings:[],
    raw_summary:'Test clean rendering',
    confirmed:true
  })
  const st=get()
  expect(st.profile.conditions).toEqual(['Tăng huyết áp độ 2','GERD','Gout'])
  expect(st.profile.medications).toEqual(['Metformin','Zyloric (Allopurinol)'])
  render(<MemoryRouter><Dashboard/></MemoryRouter>)
  expect(screen.getByText('Metformin')).toBeTruthy()
  expect(screen.getByText('Zyloric (Allopurinol)')).toBeTruthy()
  expect(screen.queryByText(/Metformin\s*\(Metformin\)/)).toBeNull()
  expect(screen.queryByText(/Zyloric\s*\(Allopurinol\)\s*\(Allopurinol\)/)).toBeNull()
})
it('renders AI Chat markdown cleanly without raw ** and hides stale cleared-record banner when a record exists',()=>{
  reset()
  login('patient@demo.vn','Demo123!')
  set(d=>{
    d.chat=[
      {from:'b',text:'Hồ sơ bệnh án đã được làm sạch. Sơ đồ Giải phẫu và Hệ thống CDSS đã trở về trạng thái khỏe mạnh ban đầu.'},
      {from:'b',text:'### Tóm tắt\n- **Bệnh lý chính:** Tăng huyết áp\n- **Lưu ý:** Hạn chế *muối* dưới 1500mg'}
    ]
  })
  const{container}=render(<MemoryRouter><Chat/></MemoryRouter>)
  expect(screen.queryByText(/Hồ sơ bệnh án đã được làm sạch/)).toBeNull()
  expect(screen.queryByText(/\*\*/)).toBeNull()
  const strongs=Array.from(container.querySelectorAll('strong')).map(el=>el.textContent)
  expect(strongs).toContain('Bệnh lý chính:')
  expect(strongs).toContain('Lưu ý:')
  expect(container.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(2)
})
it('cleans LaTeX math notation like $\\le 42\\,\\text{g/ngày}$ into natural Unicode text', () => {
  reset()
  login('patient@demo.vn', 'Demo123!')
  set(d => {
    d.chat = [
      { from: 'u', text: 'Tôi suy thận nên ăn bao nhiêu đạm?' },
      { from: 'b', text: 'Ngưỡng an toàn: Đạm $\\le 42\\,\\text{g/ngày}$, Natri $\\le 1400\\,\\text{mg/ngày}$, Kali $\\le 1800\\,\\text{mg/ngày}$, GI $\\le 50$.' }
    ]
  })
  const { container } = render(<MemoryRouter><Chat /></MemoryRouter>)
  expect(container.textContent).toContain('Đạm ≤ 42 g/ngày')
  expect(container.textContent).toContain('Natri ≤ 1400 mg/ngày')
  expect(container.textContent).not.toContain('\\le')
  expect(container.textContent).not.toContain('\\text')
  expect(container.textContent).not.toContain('$')
})
it('collapses CDSS scope control banner by default on Planner and toggles details on click',()=>{
  reset()
  login('patient@demo.vn','Demo123!')
  set(d=>{
    d.profile.conditions=['Suy thận mạn CKD Giai đoạn 4','Tăng huyết áp độ 2']
  })
  render(<MemoryRouter><Planner/></MemoryRouter>)
  expect(screen.getByText(/Cổng kiểm soát phạm vi CDSS:/i)).toBeTruthy()
  const toggleBtn=screen.getByRole('button',{name:'Xem chi tiết'})
  expect(toggleBtn.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText(/Nhiều bệnh lý cùng lúc/i)).toBeNull()
  fireEvent.click(toggleBtn)
  expect(screen.getByRole('button',{name:'Thu gọn'}).getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText(/Nhiều bệnh lý cùng lúc/i)).toBeTruthy()
})
it('hides floating AI assistant button in Shell to avoid overlapping FDA footer',()=>{
  reset()
  login('patient@demo.vn','Demo123!')
  render(<MemoryRouter><Shell/></MemoryRouter>)
  expect(screen.queryByTitle('Mở rộng Trợ lý AI CDSS')).toBeNull()
})
it('applies flex-wrap to prompt suggestions bar in AI CDSS Chat',()=>{
  render(<MemoryRouter><Chat/></MemoryRouter>)
  const promptBar = screen.getByText('Gợi ý:').parentElement
  expect(promptBar?.className).toContain('flex-wrap')
})
it('widens food lookup search input and displays unit / 100g on each food card',()=>{
  render(<Foods/>)
  const input = screen.getByLabelText('Tìm thực phẩm')
  expect(input.className).toContain('!w-80')
  expect(screen.getAllByText(/\/ 100g/i).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/kcal \/ 100g/i).length).toBeGreaterThan(0)
})
it('wraps pathology text on bottom-left HUD card in AnatomyVisualizer without truncate',()=>{
  applyPresetMedicalRecord('preset-kidney-stones')
  const { container } = render(<AnatomyVisualizer/>)
  const diseaseEl = screen.getByText(/BỆNH LÝ: Sỏi thận/i)
  expect(diseaseEl).toBeTruthy()
  expect(diseaseEl.className).toContain('break-words')
  expect(diseaseEl.className).not.toContain('truncate')
})
})
