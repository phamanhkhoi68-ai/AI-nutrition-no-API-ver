import React, { ReactNode } from 'react'

export interface TableColumn<T> {
  key: string
  header: string
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  emptyText = 'Chưa có dữ liệu phù hợp.'
}: {
  rows: T[]
  columns: TableColumn<T>[]
  rowKey: (row: T, index: number) => string
  emptyText?: string
}) {
  return (
    <div className="overflow-x-auto border border-rule rounded-[10px] bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-paper border-b border-rule">
          <tr className="text-left text-muted text-xs">
            {columns.map(col => (
              <th
                key={col.key}
                className={`p-2.5 font-semibold ${col.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((row, idx) => (
            <tr key={rowKey(row, idx)} className="hover:bg-paper/60 transition-colors">
              {columns.map(col => (
                <td
                  key={col.key}
                  className={`p-2.5 tabular-nums ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="p-6 text-center text-muted text-xs">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
