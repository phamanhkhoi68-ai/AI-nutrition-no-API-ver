import React, { useState } from 'react'

let toastFn: (m: string) => void = () => {}

export const toast = (m: string) => toastFn(m)

export function Toaster() {
  const [m, setM] = useState('')
  toastFn = (t: string) => {
    setM(t)
    setTimeout(() => setM(''), 2800)
  }
  return m ? (
    <div
      role="status"
      className="fixed bottom-12 right-4 bg-brand text-white px-4 py-2.5 rounded-[10px] z-50 text-sm shadow-md border border-brand-900"
    >
      {m}
    </div>
  ) : null
}
